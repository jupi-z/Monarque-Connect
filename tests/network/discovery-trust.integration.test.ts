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

describe('Network discovery and trust projections', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let publicOrganizationId = '';
  let privateOrganizationId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = connectionString;
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-network-discovery-test';
    process.env.JWT_AUDIENCE = 'monarque-connect-api-network-discovery-test';
    process.env.JWT_KEY_ID = 'phase4-network-discovery-test';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.organizationNetworkTrust.deleteMany();
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

    const registration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: 'phase4-network-discovery-owner@example.com', password: 'correct horse battery staple', firstName: 'Discovery', lastName: 'Owner' }).expect(201);
    const login = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(registration).email, password: 'correct horse battery staple' }).expect(200);
    ownerToken = bodyOf<{ accessToken: string }>(login).accessToken;
    const publicOrganization = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Alpha Discovery Network', handle: `alpha-discovery-${Date.now()}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
    publicOrganizationId = bodyOf<{ id: string }>(publicOrganization).id;
    await request(serverOf(app)).patch(`/api/v1/organizations/${publicOrganizationId}/network-profile`).set('Authorization', `Bearer ${ownerToken}`).send({ isPublic: true, displayName: 'Alpha Discovery Network', categories: ['consulting'], publicLocation: 'Paris', publishedItemIds: [] }).expect(200);
    const privateOrganization = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Private Discovery Network', handle: `private-discovery-${Date.now()}`, defaultCurrency: 'EUR', establishmentName: 'Private office' }).expect(201);
    privateOrganizationId = bodyOf<{ id: string }>(privateOrganization).id;
  }, 60000);

  afterAll(async () => { if (app) await app.close(); });

  it('discovers only public profiles with cursor pagination and allowlisted fields', async () => {
    const page = await request(serverOf(app)).get('/api/v1/network/organizations?limit=1&q=Alpha&businessTypeCode=SERVICE_PROVIDER&verified=false').expect(200);
    const body = bodyOf<{ items: Array<Record<string, unknown>>; nextCursor: string | null }>(page);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual(expect.objectContaining({ organizationId: publicOrganizationId, displayName: 'Alpha Discovery Network', verified: false }));
    expect(body.items[0]).not.toHaveProperty('handle');
    expect(body.items[0]).not.toHaveProperty('memberships');
    expect(body.items[0]).not.toHaveProperty('entitlements');
    expect(body.nextCursor).toBeNull();
  });

  it('does not reveal private organizations through discovery or trust', async () => {
    const privateSearch = await request(serverOf(app)).get(`/api/v1/network/organizations?q=${encodeURIComponent('Private Discovery')}`).expect(200);
    expect(bodyOf<{ items: Array<{ organizationId: string }> }>(privateSearch).items).toEqual([]);
    await request(serverOf(app)).get(`/api/v1/network/organizations/${privateOrganizationId}/trust`).expect(404);
  });

  it('returns platform trust defaults only for a public profile', async () => {
    const trust = await request(serverOf(app)).get(`/api/v1/network/organizations/${publicOrganizationId}/trust`).expect(200);
    expect(bodyOf<Record<string, unknown>>(trust)).toEqual({ organizationId: publicOrganizationId, verificationStatus: 'UNVERIFIED', verifiedAt: null, verificationExpiresAt: null, publishedCredentials: [] });
  });
});

function bodyOf<T>(response: Response): T { return response.body as T; }
function serverOf(application: INestApplication): Parameters<typeof request>[0] { return application.getHttpServer() as Parameters<typeof request>[0]; }
