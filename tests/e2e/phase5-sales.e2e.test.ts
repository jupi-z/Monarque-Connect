import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPair, randomUUID } from 'node:crypto';
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

describe('Phase 5 Sales E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let otherToken = '';
  let scopedToken = '';
  let disabledToken = '';
  let organizationId = '';
  let disabledOrganizationId = '';
  let primaryEstablishmentId = '';
  let secondaryEstablishmentId = '';
  let partyId = '';
  let itemId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = connectionString; process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-test'; process.env.JWT_AUDIENCE = 'monarque-connect-api-test'; process.env.JWT_KEY_ID = 'phase5-e2e-test';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey); process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); app.useGlobalFilters(new ProblemDetailsFilter()); await app.init();
    prisma = app.get(PrismaService);
    await prisma.paymentRecord.deleteMany(); await prisma.invoiceLine.deleteMany(); await prisma.invoice.deleteMany(); await prisma.salesOrderLine.deleteMany(); await prisma.salesOrder.deleteMany(); await prisma.quoteLine.deleteMany(); await prisma.quote.deleteMany();
    await prisma.opportunity.deleteMany(); await prisma.lead.deleteMany(); await prisma.warehouse.deleteMany(); await prisma.item.deleteMany(); await prisma.businessParty.deleteMany(); await prisma.auditEvent.deleteMany(); await prisma.membershipEstablishmentScope.deleteMany(); await prisma.invitationEstablishmentScope.deleteMany(); await prisma.invitation.deleteMany(); await prisma.membership.deleteMany(); await prisma.establishment.deleteMany(); await prisma.organization.deleteMany(); await prisma.refreshSession.deleteMany(); await prisma.user.deleteMany(); await prisma.loginRateLimitBucket.deleteMany(); await prisma.eventConsumerReceipt.deleteMany(); await prisma.outboxEvent.deleteMany(); await seedReferenceData(prisma);

    const suffix = Date.now();
    ownerToken = await registerAndLogin(`phase5-e2e-owner-${suffix}@example.com`, 'E2E Owner');
    const organization = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Phase 5 E2E Tenant', handle: `phase5-e2e-${suffix}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
    const createdOrganization = bodyOf<{ id: string; establishment: { id: string } }>(organization); organizationId = createdOrganization.id; primaryEstablishmentId = createdOrganization.establishment.id;
    const operationsVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'OPERATIONS', version: 1 } } }); await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: operationsVersion.id } });
    secondaryEstablishmentId = bodyOf<{ id: string }>(await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'SECOND', name: 'Secondary office', type: 'BRANCH' }).expect(201)).id;
    partyId = bodyOf<{ id: string }>(await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'CUSTOMER', displayName: 'E2E Customer' }).expect(201)).id;
    itemId = bodyOf<{ id: string }>(await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', sku: 'SKU-E2E-1', name: 'E2E service', description: 'E2E snapshot', unit: 'EA', referencePrice: '25.0000', currency: 'EUR', trackInventory: false }).expect(201)).id;

    otherToken = await registerAndLogin(`phase5-e2e-other-${suffix}@example.com`, 'E2E Other');
    scopedToken = await registerAndLogin(`phase5-e2e-scoped-${suffix}@example.com`, 'E2E Scoped');
    const scopedUser = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: `phase5-e2e-scoped-${suffix}@example.com` } });
    const membershipId = randomUUID(); await prisma.membership.create({ data: { id: membershipId, organizationId, userId: scopedUser.id, role: 'SALES', scopeMode: 'SELECTED_ESTABLISHMENTS' } }); await prisma.membershipEstablishmentScope.create({ data: { membershipId, organizationId, establishmentId: primaryEstablishmentId } });
    disabledToken = await registerAndLogin(`phase5-e2e-disabled-${suffix}@example.com`, 'E2E Disabled');
    const disabledOrganization = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${disabledToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Phase 5 Disabled Tenant', handle: `phase5-disabled-${suffix}`, defaultCurrency: 'EUR', establishmentName: 'Disabled office' }).expect(201);
    disabledOrganizationId = bodyOf<{ id: string }>(disabledOrganization).id;
  });

  afterAll(async () => { if (app) await app.close(); });

  it('executes Quote to paid PaymentRecord with immutable snapshots and derived balances', async () => {
    const quote = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'e2e-quote-create').send({ establishmentId: primaryEstablishmentId, partyId, validUntil: '2027-12-31', currency: 'EUR', lines: [{ itemId, descriptionSnapshot: 'Client text', unitSnapshot: 'CLIENT', quantity: '1', unitPrice: '25', taxMode: 'EXCLUSIVE', taxRate: '20', taxCodeSnapshot: 'VAT-E2E' }] }).expect(201);
    const quoteId = bodyOf<{ id: string }>(quote).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${quoteId}/send`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'e2e-quote-send').expect(200);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${quoteId}/accept`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'e2e-quote-accept').expect(200);
    const order = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${quoteId}/convert-to-order`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'e2e-order-convert').expect(201);
    const orderId = bodyOf<{ id: string }>(order).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders/${orderId}/confirm`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'e2e-order-confirm').expect(200);
    const invoice = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders/${orderId}/convert-to-invoice`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'e2e-invoice-convert').expect(201);
    const invoiceId = bodyOf<{ id: string }>(invoice).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/invoices/${invoiceId}/issue`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'e2e-invoice-issue').expect(200);
    const payment = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/invoices/${invoiceId}/payments`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'e2e-payment-record').send({ amount: '30.0000', currency: 'EUR', methodCode: 'TEST', paidAt: '2026-10-13T12:00:00.000Z' }).expect(201);
    expect(bodyOf<{ status: string; invoiceId: string }>(payment)).toMatchObject({ status: 'RECORDED', invoiceId });
    const finalInvoice = await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/invoices/${invoiceId}`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ status: string; paidAmount: string; outstandingAmount: string; lines: Array<Record<string, string>> }>(finalInvoice)).toMatchObject({ status: 'PAID', paidAmount: '30.0000', outstandingAmount: '0.0000' });
    expect(bodyOf<{ lines: Array<Record<string, string>> }>(finalInvoice).lines[0]).toMatchObject({ descriptionSnapshot: 'E2E snapshot', taxCodeSnapshot: 'VAT-E2E' });
  });

  it('enforces tenant, selected-establishment and disabled-SALES isolation', async () => {
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/invoices`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    const secondaryOrder = await createOrder('e2e-secondary', secondaryEstablishmentId);
    const secondaryInvoice = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders/${secondaryOrder}/convert-to-invoice`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'e2e-secondary-invoice').expect(201);
    const secondaryInvoiceId = bodyOf<{ id: string }>(secondaryInvoice).id;
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/invoices/${secondaryInvoiceId}`).set('Authorization', `Bearer ${scopedToken}`).expect(403);
    await request(serverOf(app)).get(`/api/v1/organizations/${disabledOrganizationId}/invoices`).set('Authorization', `Bearer ${disabledToken}`).expect(403);
  });

  async function createOrder(key: string, establishment: string): Promise<string> {
    const order = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `${key}-order`).send({ establishmentId: establishment, partyId, currency: 'EUR', lines: [{ itemId, descriptionSnapshot: 'Client text', unitSnapshot: 'CLIENT', quantity: '1', unitPrice: '25', taxMode: 'EXCLUSIVE', taxRate: '20' }] }).expect(201);
    const orderId = bodyOf<{ id: string }>(order).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders/${orderId}/confirm`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `${key}-confirm`).expect(200);
    return orderId;
  }

  async function registerAndLogin(email: string, name: string): Promise<string> {
    const [firstName, lastName] = name.split(' ');
    const registration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email, password: 'correct horse battery staple', firstName, lastName }).expect(201);
    const login = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(registration).email, password: 'correct horse battery staple' }).expect(200);
    return bodyOf<{ accessToken: string }>(login).accessToken;
  }
});

function bodyOf<T>(response: Response): T { return response.body as T; }
function serverOf(application: INestApplication): Parameters<typeof request>[0] { return application.getHttpServer() as Parameters<typeof request>[0]; }
