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

describe('Business parties referential', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let otherToken = '';
  let organizationId = '';
  let organizationHandle = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = connectionString;
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-test';
    process.env.JWT_AUDIENCE = 'monarque-connect-api-test';
    process.env.JWT_KEY_ID = 'phase3-parties-test';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.opportunity.deleteMany();
    await prisma.lead.deleteMany();
    await prisma.paymentRecord.deleteMany();
    await prisma.invoiceLine.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.salesOrderLine.deleteMany();
    await prisma.salesOrder.deleteMany();
    await prisma.quoteLine.deleteMany();
    await prisma.quote.deleteMany();
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

    const ownerRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: 'phase3-party-owner@example.com', password: 'correct horse battery staple', firstName: 'Phase', lastName: 'Owner' }).expect(201);
    const ownerLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(ownerRegistration).email, password: 'correct horse battery staple' }).expect(200);
    ownerToken = bodyOf<{ accessToken: string }>(ownerLogin).accessToken;

    organizationHandle = `phase3-party-${Date.now()}`;
    const organization = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Phase 3 Party Tenant', handle: organizationHandle, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
    organizationId = bodyOf<{ id: string }>(organization).id;
    const operationsVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'OPERATIONS', version: 1 } } });
    await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: operationsVersion.id } });

    const otherRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: 'phase3-party-other@example.com', password: 'correct horse battery staple', firstName: 'Other', lastName: 'Owner' }).expect(201);
    const otherLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(otherRegistration).email, password: 'correct horse battery staple' }).expect(200);
    otherToken = bodyOf<{ accessToken: string }>(otherLogin).accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('creates and lists a tenant party with an atomic audit and outbox event', async () => {
    const server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
    const created = await request(server).post(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'CUSTOMER', displayName: 'Acme Client', email: 'contact@acme.example' }).expect(201);
    const party = bodyOf<{ id: string; organizationId: string; type: string; displayName: string; active: boolean }>(created);
    expect(party).toMatchObject({ organizationId, type: 'CUSTOMER', displayName: 'Acme Client', active: true });

    const listed = await request(server).get(`/api/v1/organizations/${organizationId}/parties?active=true`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ items: Array<{ id: string }> }>(listed).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: party.id })]));
    await expect(prisma.auditEvent.findFirst({ where: { targetType: 'BusinessParty', targetId: party.id, action: 'BUSINESS_PARTY_CREATED' } })).resolves.not.toBeNull();
    await expect(prisma.outboxEvent.findFirst({ where: { aggregateType: 'BusinessParty', aggregateId: party.id, eventType: 'business_party.created' } })).resolves.not.toBeNull();
  });

  it('excludes inactive parties by default while allowing an explicit inactive filter', async () => {
    const server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
    const created = await request(server).post(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'SUPPLIER', displayName: 'Inactive Supplier' }).expect(201);
    const partyId = bodyOf<{ id: string }>(created).id;
    await request(server).post(`/api/v1/organizations/${organizationId}/parties/${partyId}/deactivate`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const defaultList = await request(server).get(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const inactiveList = await request(server).get(`/api/v1/organizations/${organizationId}/parties?active=false`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ items: Array<{ id: string }> }>(defaultList).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: partyId })]));
    expect(bodyOf<{ items: Array<{ id: string }> }>(inactiveList).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: partyId })]));
  });

  it('emits one status event for concurrent party deactivation requests', async () => {
    const server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
    const created = await request(server).post(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'CUSTOMER', displayName: 'Concurrent Party' }).expect(201);
    const partyId = bodyOf<{ id: string }>(created).id;
    const responses = await Promise.all([
      request(server).post(`/api/v1/organizations/${organizationId}/parties/${partyId}/deactivate`).set('Authorization', `Bearer ${ownerToken}`),
      request(server).post(`/api/v1/organizations/${organizationId}/parties/${partyId}/deactivate`).set('Authorization', `Bearer ${ownerToken}`),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    await expect(prisma.auditEvent.count({ where: { targetType: 'BusinessParty', targetId: partyId, action: 'BUSINESS_PARTY_STATUS_CHANGED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { aggregateType: 'BusinessParty', aggregateId: partyId, eventType: 'business_party.status_changed' } })).resolves.toBe(1);
  });

  it('rejects party creation when CRM is disabled', async () => {
    await prisma.organizationModuleActivation.upsert({ where: { organizationId_moduleCode: { organizationId, moduleCode: 'CRM' } }, update: { enabled: false }, create: { id: crypto.randomUUID(), organizationId, moduleCode: 'CRM', enabled: false } });
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'SUPPLIER', displayName: 'Blocked Supplier' }).expect(403);
    await prisma.organizationModuleActivation.update({ where: { organizationId_moduleCode: { organizationId, moduleCode: 'CRM' } }, data: { enabled: true } });
  });

  it('does not reveal parties across tenants', async () => {
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${otherToken}`).expect(403);
  });
});

function bodyOf<T>(response: Response): T {
  return response.body as T;
}

function serverOf(application: INestApplication): Parameters<typeof request>[0] {
  const server: unknown = application.getHttpServer();
  return server as Parameters<typeof request>[0];
}
