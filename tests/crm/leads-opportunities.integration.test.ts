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

describe('CRM leads and opportunities', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let scopedToken = '';
  let otherToken = '';
  let organizationId = '';
  let primaryEstablishmentId = '';
  let secondaryEstablishmentId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = connectionString;
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-test';
    process.env.JWT_AUDIENCE = 'monarque-connect-api-test';
    process.env.JWT_KEY_ID = 'phase4-crm-test';
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

    const ownerRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: 'phase4-crm-owner@example.com', password: 'correct horse battery staple', firstName: 'CRM', lastName: 'Owner' }).expect(201);
    const ownerLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(ownerRegistration).email, password: 'correct horse battery staple' }).expect(200);
    ownerToken = bodyOf<{ accessToken: string }>(ownerLogin).accessToken;

    const organization = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Phase 4 CRM Tenant', handle: `phase4-crm-${Date.now()}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
    const createdOrganization = bodyOf<{ id: string; establishment: { id: string } }>(organization);
    organizationId = createdOrganization.id;
    primaryEstablishmentId = createdOrganization.establishment.id;
    const operationsVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'OPERATIONS', version: 1 } } });
    await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: operationsVersion.id } });
    const secondary = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'SECOND', name: 'Secondary office', type: 'BRANCH' }).expect(201);
    secondaryEstablishmentId = bodyOf<{ id: string }>(secondary).id;

    const scopedRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: 'phase4-crm-scoped@example.com', password: 'correct horse battery staple', firstName: 'CRM', lastName: 'Scoped' }).expect(201);
    const scopedLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(scopedRegistration).email, password: 'correct horse battery staple' }).expect(200);
    scopedToken = bodyOf<{ accessToken: string }>(scopedLogin).accessToken;
    const scopedUser = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: 'phase4-crm-scoped@example.com' } });
    const membershipId = crypto.randomUUID();
    await prisma.membership.create({ data: { id: membershipId, organizationId, userId: scopedUser.id, role: 'SALES', scopeMode: 'SELECTED_ESTABLISHMENTS' } });
    await prisma.membershipEstablishmentScope.create({ data: { membershipId, organizationId, establishmentId: primaryEstablishmentId } });

    const otherRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: 'phase4-crm-other@example.com', password: 'correct horse battery staple', firstName: 'CRM', lastName: 'Other' }).expect(201);
    const otherLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(otherRegistration).email, password: 'correct horse battery staple' }).expect(200);
    otherToken = bodyOf<{ accessToken: string }>(otherLogin).accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('creates and lists a tenant lead with atomic audit and outbox records', async () => {
    const created = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/leads`).set('Authorization', `Bearer ${ownerToken}`).send({ displayName: 'Acme prospect', email: 'contact@acme.example', notes: 'First contact' }).expect(201);
    const lead = bodyOf<{ id: string; organizationId: string; status: string; source: string; active: boolean }>(created);
    expect(lead).toMatchObject({ organizationId, status: 'NEW', source: 'DIRECT', active: true });

    const listed = await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/leads?q=Acme`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ items: Array<{ id: string }> }>(listed).items).toEqual([expect.objectContaining({ id: lead.id })]);
    await expect(prisma.auditEvent.findFirst({ where: { targetType: 'Lead', targetId: lead.id, action: 'LEAD_CREATED' } })).resolves.not.toBeNull();
    await expect(prisma.outboxEvent.findFirst({ where: { aggregateType: 'Lead', aggregateId: lead.id, eventType: 'crm.lead.created' } })).resolves.not.toBeNull();
  });

  it('keeps leads tenant isolated and blocks CRM when the module is disabled', async () => {
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/leads`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    await prisma.organizationModuleActivation.upsert({ where: { organizationId_moduleCode: { organizationId, moduleCode: 'CRM' } }, update: { enabled: false }, create: { id: crypto.randomUUID(), organizationId, moduleCode: 'CRM', enabled: false } });
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/leads`).set('Authorization', `Bearer ${ownerToken}`).send({ displayName: 'Blocked lead' }).expect(403);
    await prisma.organizationModuleActivation.update({ where: { organizationId_moduleCode: { organizationId, moduleCode: 'CRM' } }, data: { enabled: true } });
  });

  it('enforces establishment scope when creating and listing opportunities', async () => {
    const allowed = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/opportunities`).set('Authorization', `Bearer ${scopedToken}`).send({ establishmentId: primaryEstablishmentId, name: 'Primary opportunity', expectedValue: '12500.50', currency: 'EUR' }).expect(201);
    const opportunity = bodyOf<{ id: string; organizationId: string; establishmentId: string; status: string; source: string }>(allowed);
    expect(opportunity).toMatchObject({ organizationId, establishmentId: primaryEstablishmentId, status: 'OPEN', source: 'DIRECT' });
    const listed = await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/opportunities?establishmentId=${primaryEstablishmentId}`).set('Authorization', `Bearer ${scopedToken}`).expect(200);
    expect(bodyOf<{ items: Array<{ id: string }> }>(listed).items).toEqual([expect.objectContaining({ id: opportunity.id })]);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/opportunities`).set('Authorization', `Bearer ${scopedToken}`).send({ establishmentId: secondaryEstablishmentId, name: 'Blocked opportunity' }).expect(403);
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/opportunities?establishmentId=${secondaryEstablishmentId}`).set('Authorization', `Bearer ${scopedToken}`).expect(403);
    await expect(prisma.auditEvent.findFirst({ where: { targetType: 'Opportunity', targetId: opportunity.id, action: 'OPPORTUNITY_CREATED', establishmentId: primaryEstablishmentId } })).resolves.not.toBeNull();
    await expect(prisma.outboxEvent.findFirst({ where: { aggregateType: 'Opportunity', aggregateId: opportunity.id, eventType: 'crm.opportunity.created', establishmentId: primaryEstablishmentId } })).resolves.not.toBeNull();
  });

  it('validates lead transitions and makes retries idempotent', async () => {
    const created = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/leads`).set('Authorization', `Bearer ${ownerToken}`).send({ displayName: 'Qualified prospect' }).expect(201);
    const leadId = bodyOf<{ id: string }>(created).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/leads/${leadId}/status`).set('Authorization', `Bearer ${ownerToken}`).send({ status: 'QUALIFIED' }).expect(200);
    const repeated = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/leads/${leadId}/status`).set('Authorization', `Bearer ${ownerToken}`).send({ status: 'QUALIFIED' }).expect(200);
    expect(bodyOf<{ status: string }>(repeated).status).toBe('QUALIFIED');
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/leads/${leadId}/status`).set('Authorization', `Bearer ${ownerToken}`).send({ status: 'NEW' }).expect(400);
    await expect(prisma.auditEvent.count({ where: { targetType: 'Lead', targetId: leadId, action: 'LEAD_STATUS_CHANGED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { aggregateType: 'Lead', aggregateId: leadId, eventType: 'crm.lead.status_changed' } })).resolves.toBe(1);
  });

  it('allows only one effective concurrent opportunity transition', async () => {
    const created = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/opportunities`).set('Authorization', `Bearer ${ownerToken}`).send({ establishmentId: primaryEstablishmentId, name: 'Race opportunity' }).expect(201);
    const opportunityId = bodyOf<{ id: string }>(created).id;
    const responses = await Promise.all([
      request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/opportunities/${opportunityId}/status`).set('Authorization', `Bearer ${ownerToken}`).send({ status: 'WON' }),
      request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/opportunities/${opportunityId}/status`).set('Authorization', `Bearer ${ownerToken}`).send({ status: 'LOST' }),
    ]);
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 409]);
    await expect(prisma.auditEvent.count({ where: { targetType: 'Opportunity', targetId: opportunityId, action: 'OPPORTUNITY_STATUS_CHANGED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { aggregateType: 'Opportunity', aggregateId: opportunityId, eventType: 'crm.opportunity.status_changed' } })).resolves.toBe(1);
  });
});

function bodyOf<T>(response: Response): T {
  return response.body as T;
}

function serverOf(application: INestApplication): Parameters<typeof request>[0] {
  const server: unknown = application.getHttpServer();
  return server as Parameters<typeof request>[0];
}
