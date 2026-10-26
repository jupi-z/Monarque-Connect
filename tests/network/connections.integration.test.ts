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
const password = 'correct horse battery staple';

describe('Network connection requests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerAToken = '';
  let ownerBToken = '';
  let ownerCToken = '';
  let organizationA = '';
  let organizationB = '';
  let organizationC = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = connectionString;
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-network-connections-test';
    process.env.JWT_AUDIENCE = 'monarque-connect-api-network-connections-test';
    process.env.JWT_KEY_ID = 'phase4-network-connections-test';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.connectionRequest.deleteMany();
    await prisma.organizationNetworkTrust.deleteMany();
    await prisma.organizationNetworkProfile.deleteMany();
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

    const a = await createUser(app, 'connections-a');
    const b = await createUser(app, 'connections-b');
    const c = await createUser(app, 'connections-c');
    ownerAToken = a.token;
    ownerBToken = b.token;
    ownerCToken = c.token;
    organizationA = await createOrganization(app, ownerAToken, 'connections-a');
    organizationB = await createOrganization(app, ownerBToken, 'connections-b');
    organizationC = await createOrganization(app, ownerCToken, 'connections-c');
    await makePublic(app, ownerBToken, organizationB, 'Connections B');
    await makePublic(app, ownerCToken, organizationC, 'Connections C');
  }, 60000);

  afterAll(async () => { if (app) await app.close(); });

  it('creates a request only for an eligible public target and records one audit plus one event', async () => {
    const target = await createPublicTarget(app, 'connections-create-target');
    const response = await request(serverOf(app)).post(`/api/v1/organizations/${organizationA}/connection-requests`).set('Authorization', `Bearer ${ownerAToken}`).send({ targetOrganizationId: target.organizationId, message: 'Let us connect.' }).expect(201);
    const requestId = bodyOf<{ id: string }>(response).id;
    expect(response.body).toEqual(expect.objectContaining({ id: requestId, sourceOrganizationId: organizationA, targetOrganizationId: target.organizationId, status: 'PENDING', message: 'Let us connect.' }));
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationA}/connection-requests`).set('Authorization', `Bearer ${ownerAToken}`).send({ targetOrganizationId: target.organizationId }).expect(409);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationA}/connection-requests`).set('Authorization', `Bearer ${ownerAToken}`).send({ targetOrganizationId: organizationA }).expect(409);
    await expect(prisma.auditEvent.count({ where: { action: 'CONNECTION_REQUEST_CREATED', targetId: requestId } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { eventType: 'network.connection.requested', aggregateId: requestId } })).resolves.toBe(1);
  });

  it('lists requests for either participating organization and enforces actor and side authority', async () => {
    const target = await createPublicTarget(app, 'connections-list-target');
    const created = await request(serverOf(app)).post(`/api/v1/organizations/${organizationA}/connection-requests`).set('Authorization', `Bearer ${ownerAToken}`).send({ targetOrganizationId: target.organizationId, message: 'List scenario.' }).expect(201);
    const id = bodyOf<{ id: string }>(created).id;
    const sourceList = bodyOf<{ items: Array<{ id: string }> }>(await request(serverOf(app)).get(`/api/v1/organizations/${organizationA}/connection-requests`).set('Authorization', `Bearer ${ownerAToken}`).expect(200));
    const targetList = bodyOf<{ items: Array<{ id: string }> }>(await request(serverOf(app)).get(`/api/v1/organizations/${target.organizationId}/connection-requests`).set('Authorization', `Bearer ${target.token}`).expect(200));
    expect(sourceList.items).toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
    expect(targetList.items).toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationA}/connection-requests/${id}`).set('Authorization', `Bearer ${ownerAToken}`).send({ status: 'ACCEPTED' }).expect(403);
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationA}/connection-requests/${id}`).set('Authorization', `Bearer ${ownerCToken}`).send({ status: 'CANCELLED' }).expect(403);
    await request(serverOf(app)).patch(`/api/v1/organizations/${target.organizationId}/connection-requests/${id}`).set('Authorization', `Bearer ${target.token}`).send({ status: 'ACCEPTED' }).expect(200);
    await request(serverOf(app)).patch(`/api/v1/organizations/${target.organizationId}/connection-requests/${id}`).set('Authorization', `Bearer ${target.token}`).send({ status: 'DECLINED' }).expect(409);
    await expect(prisma.auditEvent.count({ where: { action: 'CONNECTION_REQUEST_STATUS_CHANGED', targetId: id } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { eventType: 'network.connection.status_changed', aggregateId: id } })).resolves.toBe(1);
  });

  it('serializes concurrent terminal transitions so only one request wins', async () => {
    const created = await request(serverOf(app)).post(`/api/v1/organizations/${organizationA}/connection-requests`).set('Authorization', `Bearer ${ownerAToken}`).send({ targetOrganizationId: organizationC }).expect(201);
    const id = bodyOf<{ id: string }>(created).id;
    const results = await Promise.all([
      request(serverOf(app)).patch(`/api/v1/organizations/${organizationC}/connection-requests/${id}`).set('Authorization', `Bearer ${ownerCToken}`).send({ status: 'ACCEPTED' }),
      request(serverOf(app)).patch(`/api/v1/organizations/${organizationC}/connection-requests/${id}`).set('Authorization', `Bearer ${ownerCToken}`).send({ status: 'DECLINED' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    await expect(prisma.outboxEvent.count({ where: { eventType: 'network.connection.status_changed', aggregateId: id } })).resolves.toBe(1);
  });

  it('allows the source to cancel a pending request and blocks the module when disabled', async () => {
    const created = await request(serverOf(app)).post(`/api/v1/organizations/${organizationB}/connection-requests`).set('Authorization', `Bearer ${ownerBToken}`).send({ targetOrganizationId: organizationC }).expect(201);
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationB}/connection-requests/${bodyOf<{ id: string }>(created).id}`).set('Authorization', `Bearer ${ownerBToken}`).send({ status: 'CANCELLED' }).expect(200);
    await prisma.organizationModuleActivation.upsert({ where: { organizationId_moduleCode: { organizationId: organizationA, moduleCode: 'NETWORK_CONNECTIONS' } }, update: { enabled: false }, create: { id: crypto.randomUUID(), organizationId: organizationA, moduleCode: 'NETWORK_CONNECTIONS', enabled: false } });
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationA}/connection-requests`).set('Authorization', `Bearer ${ownerAToken}`).expect(403);
    await prisma.organizationModuleActivation.upsert({ where: { organizationId_moduleCode: { organizationId: organizationA, moduleCode: 'NETWORK_CONNECTIONS' } }, update: { enabled: true }, create: { id: crypto.randomUUID(), organizationId: organizationA, moduleCode: 'NETWORK_CONNECTIONS', enabled: true } });
  });
});

async function createUser(app: INestApplication, slug: string): Promise<{ token: string }> {
  const email = `${slug}-${Date.now()}@example.com`;
  const registration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email, password, firstName: slug, lastName: 'Owner' }).expect(201);
  const login = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(registration).email, password }).expect(200);
  return { token: bodyOf<{ accessToken: string }>(login).accessToken };
}

async function createOrganization(app: INestApplication, token: string, slug: string): Promise<string> {
  const response = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${token}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: `Connections ${slug}`, handle: `${slug}-${Date.now()}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
  return bodyOf<{ id: string }>(response).id;
}

async function makePublic(app: INestApplication, token: string, organizationId: string, displayName: string): Promise<void> {
  await request(serverOf(app)).patch(`/api/v1/organizations/${organizationId}/network-profile`).set('Authorization', `Bearer ${token}`).send({ isPublic: true, displayName, categories: ['network'], publishedItemIds: [] }).expect(200);
}

async function createPublicTarget(app: INestApplication, slug: string): Promise<{ token: string; organizationId: string }> {
  const user = await createUser(app, slug);
  const targetOrganizationId = await createOrganization(app, user.token, slug);
  await makePublic(app, user.token, targetOrganizationId, slug);
  return { token: user.token, organizationId: targetOrganizationId };
}

function bodyOf<T>(response: Response): T { return response.body as T; }
function serverOf(application: INestApplication): Parameters<typeof request>[0] { return application.getHttpServer() as Parameters<typeof request>[0]; }
