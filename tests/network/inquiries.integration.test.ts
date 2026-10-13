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

describe('Network inquiries and CRM conversion', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerAToken = '';
  let ownerBToken = '';
  let ownerCToken = '';
  let organizationA = '';
  let organizationB = '';
  let organizationC = '';
  let establishmentB = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = connectionString; process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-network-inquiries-test'; process.env.JWT_AUDIENCE = 'monarque-connect-api-network-inquiries-test'; process.env.JWT_KEY_ID = 'phase4-network-inquiries-test';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey); process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); app.useGlobalFilters(new ProblemDetailsFilter()); await app.init();
    prisma = app.get(PrismaService);
    await prisma.opportunity.deleteMany(); await prisma.lead.deleteMany(); await prisma.networkInquiry.deleteMany(); await prisma.connectionRequest.deleteMany(); await prisma.organizationNetworkTrust.deleteMany(); await prisma.organizationNetworkProfile.deleteMany();
    await prisma.paymentRecord.deleteMany(); await prisma.invoiceLine.deleteMany(); await prisma.invoice.deleteMany(); await prisma.salesOrderLine.deleteMany(); await prisma.salesOrder.deleteMany(); await prisma.quoteLine.deleteMany(); await prisma.quote.deleteMany();
    await prisma.warehouse.deleteMany(); await prisma.item.deleteMany(); await prisma.businessParty.deleteMany(); await prisma.auditEvent.deleteMany(); await prisma.membershipEstablishmentScope.deleteMany(); await prisma.invitationEstablishmentScope.deleteMany(); await prisma.invitation.deleteMany(); await prisma.membership.deleteMany(); await prisma.establishment.deleteMany(); await prisma.organization.deleteMany(); await prisma.refreshSession.deleteMany(); await prisma.user.deleteMany(); await prisma.loginRateLimitBucket.deleteMany(); await prisma.eventConsumerReceipt.deleteMany(); await prisma.outboxEvent.deleteMany(); await seedReferenceData(prisma);
    const a = await createUser(app, 'inquiries-a'); const b = await createUser(app, 'inquiries-b'); const c = await createUser(app, 'inquiries-c'); ownerAToken = a.token; ownerBToken = b.token; ownerCToken = c.token;
    organizationA = await createOrganization(app, ownerAToken, 'inquiries-a'); organizationB = await createOrganization(app, ownerBToken, 'inquiries-b'); organizationC = await createOrganization(app, ownerCToken, 'inquiries-c');
    establishmentB = (await prisma.establishment.findFirstOrThrow({ where: { organizationId: organizationB }, select: { id: true } })).id;
    const operationsVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'OPERATIONS', version: 1 } }, select: { id: true } });
    await prisma.subscription.updateMany({ where: { organizationId: organizationB }, data: { planVersionId: operationsVersion.id } });
    await makePublic(app, ownerBToken, organizationB, 'Inquiries B'); await makePublic(app, ownerCToken, organizationC, 'Inquiries C');
    await connect(app, ownerAToken, organizationA, organizationB, ownerBToken);
  }, 60000);

  afterAll(async () => { if (app) await app.close(); });

  it('requires an accepted connection and records a tenant-scoped inquiry', async () => {
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationA}/network/organizations/${organizationC}/inquiries`).set('Authorization', `Bearer ${ownerAToken}`).send({ subject: 'No relationship', message: 'Should be rejected.' }).expect(409);
    const response = await request(serverOf(app)).post(`/api/v1/organizations/${organizationA}/network/organizations/${organizationB}/inquiries`).set('Authorization', `Bearer ${ownerAToken}`).send({ subject: 'Supply partnership', message: 'We would like to discuss supply.', requestedPartyType: 'SUPPLIER' }).expect(201);
    expect(response.body).toEqual(expect.objectContaining({ sourceOrganizationId: organizationA, targetOrganizationId: organizationB, status: 'NEW', requestedPartyType: 'SUPPLIER' }));
    await expect(prisma.auditEvent.count({ where: { action: 'NETWORK_INQUIRY_CREATED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { eventType: 'network.inquiry.created' } })).resolves.toBe(1);
  });

  it('lists both sides, enforces membership, and transitions inquiry status safely', async () => {
    const source = bodyOf<{ items: Array<{ id: string }> }>(await request(serverOf(app)).get(`/api/v1/organizations/${organizationA}/network-inquiries`).set('Authorization', `Bearer ${ownerAToken}`).expect(200));
    const target = bodyOf<{ items: Array<{ id: string }> }>(await request(serverOf(app)).get(`/api/v1/organizations/${organizationB}/network-inquiries?status=NEW`).set('Authorization', `Bearer ${ownerBToken}`).expect(200));
    expect(source.items).toHaveLength(1); expect(target.items).toHaveLength(1);
    const inquiryId = source.items[0]!.id;
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationB}/network-inquiries`).set('Authorization', `Bearer ${ownerCToken}`).expect(403);
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationB}/network-inquiries/${inquiryId}`).set('Authorization', `Bearer ${ownerBToken}`).send({ status: 'QUALIFIED' }).expect(200);
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationB}/network-inquiries/${inquiryId}`).set('Authorization', `Bearer ${ownerBToken}`).send({ status: 'DISMISSED' }).expect(200);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationB}/network-inquiries/${inquiryId}/convert`).set('Authorization', `Bearer ${ownerBToken}`).send({ targetType: 'LEAD' }).expect(409);
  });

  it('converts once to a Lead and returns the same result on replay', async () => {
    const created = await createInquiry(app, ownerAToken, organizationA, organizationB, 'Lead conversion');
    const first = bodyOf<{ inquiryId: string; targetType: string; targetId: string }>(await request(serverOf(app)).post(`/api/v1/organizations/${organizationB}/network-inquiries/${created.id}/convert`).set('Authorization', `Bearer ${ownerBToken}`).send({ targetType: 'LEAD' }).expect(201));
    const replay = bodyOf<{ inquiryId: string; targetType: string; targetId: string }>(await request(serverOf(app)).post(`/api/v1/organizations/${organizationB}/network-inquiries/${created.id}/convert`).set('Authorization', `Bearer ${ownerBToken}`).send({ targetType: 'LEAD' }).expect(201));
    expect(replay).toEqual(first);
    await expect(prisma.lead.count({ where: { networkInquiryId: created.id } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { eventType: 'network.inquiry.converted', aggregateId: created.id } })).resolves.toBe(1);
  });

  it('converts to an Opportunity only with an establishment and serializes concurrent retries', async () => {
    const created = await createInquiry(app, ownerAToken, organizationA, organizationB, 'Opportunity conversion');
    const results = await Promise.all([
      request(serverOf(app)).post(`/api/v1/organizations/${organizationB}/network-inquiries/${created.id}/convert`).set('Authorization', `Bearer ${ownerBToken}`).send({ targetType: 'OPPORTUNITY', establishmentId: establishmentB }),
      request(serverOf(app)).post(`/api/v1/organizations/${organizationB}/network-inquiries/${created.id}/convert`).set('Authorization', `Bearer ${ownerBToken}`).send({ targetType: 'OPPORTUNITY', establishmentId: establishmentB }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 201]);
    const conversions = results.map((result) => bodyOf<{ targetId: string }>(result));
    expect(conversions[0]!.targetId).toBe(conversions[1]!.targetId);
    await expect(prisma.opportunity.count({ where: { networkInquiryId: created.id } })).resolves.toBe(1);
  });
});

async function createUser(app: INestApplication, slug: string): Promise<{ token: string }> { const email = `${slug}-${Date.now()}@example.com`; const registration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email, password, firstName: slug, lastName: 'Owner' }).expect(201); const login = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(registration).email, password }).expect(200); return { token: bodyOf<{ accessToken: string }>(login).accessToken }; }
async function createOrganization(app: INestApplication, token: string, slug: string): Promise<string> { const response = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${token}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: `Inquiries ${slug}`, handle: `${slug}-${Date.now()}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201); return bodyOf<{ id: string }>(response).id; }
async function makePublic(app: INestApplication, token: string, organizationId: string, displayName: string): Promise<void> { await request(serverOf(app)).patch(`/api/v1/organizations/${organizationId}/network-profile`).set('Authorization', `Bearer ${token}`).send({ isPublic: true, displayName, categories: ['network'], publishedItemIds: [] }).expect(200); }
async function connect(app: INestApplication, sourceToken: string, sourceOrganizationId: string, targetOrganizationId: string, targetToken: string): Promise<void> { const created = await request(serverOf(app)).post(`/api/v1/organizations/${sourceOrganizationId}/connection-requests`).set('Authorization', `Bearer ${sourceToken}`).send({ targetOrganizationId }).expect(201); const requestId = bodyOf<{ id: string }>(created).id; await request(serverOf(app)).patch(`/api/v1/organizations/${targetOrganizationId}/connection-requests/${requestId}`).set('Authorization', `Bearer ${targetToken}`).send({ status: 'ACCEPTED' }).expect(200); }
async function createInquiry(app: INestApplication, token: string, sourceOrganizationId: string, targetOrganizationId: string, subject: string): Promise<{ id: string }> { const response = await request(serverOf(app)).post(`/api/v1/organizations/${sourceOrganizationId}/network/organizations/${targetOrganizationId}/inquiries`).set('Authorization', `Bearer ${token}`).send({ subject, message: 'Please contact us about a collaboration.' }).expect(201); return bodyOf<{ id: string }>(response); }
function bodyOf<T>(response: Response): T { return response.body as T; }
function serverOf(application: INestApplication): Parameters<typeof request>[0] { return application.getHttpServer() as Parameters<typeof request>[0]; }
