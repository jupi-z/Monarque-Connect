import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import { exportPKCS8, exportSPKI } from 'jose';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ProblemDetailsFilter } from '../../src/http/problem-details.filter.js';
import { seedReferenceData } from '../../prisma/seed.js';

const generateKeyPairAsync = promisify(generateKeyPair);

describe('Network organization profiles', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let organizationId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = connectionString;
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-network-test';
    process.env.JWT_AUDIENCE = 'monarque-connect-api-network-test';
    process.env.JWT_KEY_ID = 'phase4-network-test';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.organizationNetworkProfile.deleteMany();
    await prisma.opportunity.deleteMany();
    await prisma.lead.deleteMany();
    await prisma.warehouse.deleteMany();
    await prisma.item.deleteMany();
    await prisma.businessParty.deleteMany();
    await prisma.auditEvent.deleteMany();
    await prisma.membershipEstablishmentScope.deleteMany();
    await prisma.invitationEstablishmentScope.deleteMany();
    await prisma.invitation.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.establishment.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.refreshSession.deleteMany();
    await prisma.user.deleteMany();
    await prisma.loginRateLimitBucket.deleteMany();
    await prisma.eventConsumerReceipt.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await seedReferenceData(prisma);

    const registration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: 'phase4-network-owner@example.com', password: 'correct horse battery staple', firstName: 'Network', lastName: 'Owner' }).expect(201);
    const login = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(registration).email, password: 'correct horse battery staple' }).expect(200);
    ownerToken = bodyOf<{ accessToken: string }>(login).accessToken;
    const organization = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Network profile tenant', handle: `network-profile-${Date.now()}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
    organizationId = bodyOf<{ id: string }>(organization).id;
  });

  afterAll(async () => { if (app) await app.close(); });

  it('returns a private default profile and persists an allowlisted public projection', async () => {
    const initial = await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/network-profile`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<Record<string, unknown>>(initial)).toMatchObject({ organizationId, isPublic: false });

    const updated = await request(serverOf(app)).patch(`/api/v1/organizations/${organizationId}/network-profile`).set('Authorization', `Bearer ${ownerToken}`).send({ isPublic: true, displayName: 'Network Public Name', description: 'Public description', categories: ['consulting'], publicLocation: 'Paris', publishedItemIds: [] }).expect(200);
    expect(bodyOf<Record<string, unknown>>(updated)).toMatchObject({ organizationId, isPublic: true, displayName: 'Network Public Name' });

    const publicProfile = await request(serverOf(app)).get(`/api/v1/network/organizations/${organizationId}`).expect(200);
    expect(bodyOf<Record<string, unknown>>(publicProfile)).toEqual(expect.objectContaining({ organizationId, displayName: 'Network Public Name', description: 'Public description', categories: ['consulting'], publicLocation: 'Paris', verified: false, publishedItemIds: [] }));
    expect(publicProfile.body).not.toHaveProperty('handle');
    expect(publicProfile.body).not.toHaveProperty('entitlements');
    expect(publicProfile.body).not.toHaveProperty('memberships');
  });

  it('does not reveal a private profile and records one audit and one event per effective mutation', async () => {
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationId}/network-profile`).set('Authorization', `Bearer ${ownerToken}`).send({ isPublic: false }).expect(200);
    await request(serverOf(app)).get(`/api/v1/network/organizations/${organizationId}`).expect(404);
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationId}/network-profile`).set('Authorization', `Bearer ${ownerToken}`).send({ isPublic: false }).expect(200);
    await expect(prisma.auditEvent.count({ where: { targetType: 'OrganizationNetworkProfile', organizationId } })).resolves.toBe(2);
    await expect(prisma.outboxEvent.count({ where: { aggregateType: 'OrganizationNetworkProfile', organizationId, eventType: 'network.profile.updated' } })).resolves.toBe(2);
  });

  it('blocks profile access when the Network profile module is disabled', async () => {
    await prisma.organizationModuleActivation.upsert({ where: { organizationId_moduleCode: { organizationId, moduleCode: 'NETWORK_PROFILE' } }, update: { enabled: false }, create: { id: crypto.randomUUID(), organizationId, moduleCode: 'NETWORK_PROFILE', enabled: false } });
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/network-profile`).set('Authorization', `Bearer ${ownerToken}`).expect(403);
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationId}/network-profile`).set('Authorization', `Bearer ${ownerToken}`).send({ displayName: 'Blocked' }).expect(403);
    await prisma.organizationModuleActivation.update({ where: { organizationId_moduleCode: { organizationId, moduleCode: 'NETWORK_PROFILE' } }, data: { enabled: true } });
  });
});

function bodyOf<T>(response: Response): T { return response.body as T; }
function serverOf(application: INestApplication): Parameters<typeof request>[0] { return application.getHttpServer() as Parameters<typeof request>[0]; }
