import { generateKeyPair, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportPKCS8, exportSPKI } from 'jose';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ProblemDetailsFilter } from '../../src/http/problem-details.filter.js';
import { seedReferenceData } from '../../prisma/seed.js';

const generateKeyPairAsync = promisify(generateKeyPair);

describe('C3 tenant pricing and tax policy HTTP boundary', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_c3_policy_e2e';
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-c3-policy-e2e';
    process.env.JWT_AUDIENCE = 'monarque-connect-c3-policy-api';
    process.env.JWT_KEY_ID = 'c3-policy-e2e';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    app.get(ConfigService).set('PRICING_FX_ALLOWED_SOURCES', ['TEST_FIXTURE']);
    await seedReferenceData(prisma);
  });

  afterAll(async () => { if (app) await app.close(); });

  it('creates immutable policy versions, replays exact commands and rejects divergent idempotency', async () => {
    const tenant = await createTenant(app, prisma);
    const key = `c3-policy-command-${randomUUID()}`;
    const payload = pricingPolicyPayload();
    const firstResponse = await expectHttpStatus(request(serverOf(app))
      .post(`/api/v1/organizations/${tenant.organizationId}/pricing/policy-versions`).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', key).send(payload), 201);
    const first = bodyOf<{ id: string; organizationId: string; productCode: string; code: string; version: number; roundingMode: string; maxFxAgeSeconds: number }>(firstResponse);
    expect(first).toMatchObject({ organizationId: tenant.organizationId, productCode: 'MONARQUE_CONNECT', code: payload.code, version: 1, roundingMode: 'HALF_UP', maxFxAgeSeconds: 86400 });

    const replay = bodyOf<{ id: string }>(await request(serverOf(app))
      .post(`/api/v1/organizations/${tenant.organizationId}/pricing/policy-versions`).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', key).send(payload).expect(201));
    expect(replay.id).toBe(first.id);
    await request(serverOf(app)).post(`/api/v1/organizations/${tenant.organizationId}/pricing/policy-versions`).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', key).send({ ...payload, maxFxAgeSeconds: 3600 }).expect(409);

    await expect(prisma.pricingPolicyVersion.count({ where: { id: first.id } })).resolves.toBe(1);
    await expect(prisma.catalogCommandReceipt.count({ where: { organizationId: tenant.organizationId, actorUserId: tenant.ownerId, resourceType: 'PricingPolicyVersion', resourceId: first.id } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { organizationId: tenant.organizationId, targetType: 'PricingPolicyVersion', targetId: first.id } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId: tenant.organizationId, aggregateType: 'PricingPolicyVersion', aggregateId: first.id, eventType: 'pricing.policy_version.created' } })).resolves.toBe(1);
    await expect(prisma.pricingPolicyVersion.update({ where: { id: first.id }, data: { maxFxAgeSeconds: 1 } })).rejects.toThrow();
    await expect(prisma.pricingPolicyVersion.delete({ where: { id: first.id } })).rejects.toThrow();
  });

  it('serializes concurrent policy version creation for one tenant/product/code', async () => {
    const tenant = await createTenant(app, prisma);
    const payload = { ...pricingPolicyPayload(`CONCURRENT_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`), effectiveFrom: new Date(Date.now() + 60_000).toISOString() };
    const route = `/api/v1/organizations/${tenant.organizationId}/pricing/policy-versions`;
    const submit = (suffix: string) => request(serverOf(app)).post(route).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `c3-policy-race-${suffix}-${randomUUID()}`).send(payload);
    const [left, right] = await Promise.all([submit('left'), submit('right')]);
    expect([left.status, right.status].sort(), JSON.stringify([left.body, right.body])).toEqual([201, 409]);
    await expect(prisma.pricingPolicyVersion.count({ where: { organizationId: tenant.organizationId, productCode: 'MONARQUE_CONNECT', code: payload.code } })).resolves.toBe(1);
  });

  it('creates tax settings as a draft and only activates them after explicit acknowledgement', async () => {
    const tenant = await createTenant(app, prisma);
    const key = `c3-tax-create-${randomUUID()}`;
    const payload = taxPolicyPayload();
    const route = `/api/v1/organizations/${tenant.organizationId}/pricing/tax-policy-versions`;
    const draftResponse = await expectHttpStatus(request(serverOf(app))
      .post(route).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', key).send(payload), 201);
    const draft = bodyOf<{ id: string; status: string; rate: string; jurisdictionCode: string; configurationReference: string }>(draftResponse);
    expect(draft).toMatchObject({ status: 'DRAFT', rate: '0.160000000000000000', jurisdictionCode: payload.jurisdictionCode, configurationReference: payload.configurationReference });
    await request(serverOf(app)).post(`/api/v1/organizations/${tenant.organizationId}/pricing/tax-policy-versions/${draft.id}/activate`).query({ productCode: payload.productCode }).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `c3-tax-bad-ack-${randomUUID()}`).send({ acknowledgement: 'LEGAL_COMPLIANCE_CONFIRMED' }).expect(400);

    const activateRoute = `/api/v1/organizations/${tenant.organizationId}/pricing/tax-policy-versions/${draft.id}/activate`;
    const activationKey = `c3-tax-activate-${randomUUID()}`;
    const acknowledgement = { acknowledgement: 'OWNER_REVIEWED_CONFIGURATION' };
    const active = bodyOf<{ id: string; status: string; activatedAt: string | null }>(await request(serverOf(app))
      .post(activateRoute).query({ productCode: payload.productCode }).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', activationKey).send(acknowledgement).expect(200));
    expect(active).toMatchObject({ id: draft.id, status: 'ACTIVE' });
    expect(active.activatedAt).toBeTruthy();
    const replay = bodyOf<{ id: string; status: string }>(await request(serverOf(app))
      .post(activateRoute).query({ productCode: payload.productCode }).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', activationKey).send(acknowledgement).expect(200));
    expect(replay).toMatchObject({ id: draft.id, status: 'ACTIVE' });
    await request(serverOf(app)).post(activateRoute).query({ productCode: payload.productCode }).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', activationKey).send({ acknowledgement: 'OWNER_REVIEWED_CONFIGURATION', ignored: true }).expect(400);

    await expect(prisma.auditEvent.count({ where: { organizationId: tenant.organizationId, targetType: 'TaxPolicyVersion', targetId: draft.id, action: 'PRICING_TAX_POLICY_ACTIVATED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId: tenant.organizationId, aggregateType: 'TaxPolicyVersion', aggregateId: draft.id, eventType: 'pricing.tax_policy_version.activated' } })).resolves.toBe(1);
    await expect(prisma.taxPolicyVersion.update({ where: { id: draft.id }, data: { rate: '0' } })).rejects.toThrow();
    await expect(prisma.taxPolicyVersion.delete({ where: { id: draft.id } })).rejects.toThrow();
  });

  it('enforces owner/admin permissions, product entitlements and tenant isolation', async () => {
    const tenant = await createTenant(app, prisma);
    const outsider = await createTenant(app, prisma);
    const sales = await registerAndLogin(serverOf(app), `c3-policy-sales-${randomUUID()}@example.test`);
    const salesUser = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: sales.email }, select: { id: true } });
    await prisma.membership.create({ data: { id: randomUUID(), organizationId: tenant.organizationId, userId: salesUser.id, role: 'SALES', scopeMode: 'ALL_ESTABLISHMENTS', status: 'ACTIVE' } });
    const route = `/api/v1/organizations/${tenant.organizationId}/pricing/policy-versions`;
    await expectHttpStatus(request(serverOf(app)).post(route).set('Authorization', `Bearer ${sales.token}`).set('Idempotency-Key', `c3-policy-sales-${randomUUID()}`).send(pricingPolicyPayload()), 403);
    await request(serverOf(app)).post(`/api/v1/organizations/${outsider.organizationId}/pricing/policy-versions`).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `c3-policy-cross-${randomUUID()}`).send(pricingPolicyPayload()).expect(403);
    await request(serverOf(app)).post(route).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `c3-policy-product-${randomUUID()}`).send(pricingPolicyPayload(undefined, 'ZAMUREK')).expect(403);
    await request(serverOf(app)).post(route).set('Idempotency-Key', `c3-policy-unauth-${randomUUID()}`).send({}).expect(401);
    await expect(prisma.pricingPolicyVersion.count({ where: { organizationId: tenant.organizationId } })).resolves.toBe(0);
    await expect(prisma.pricingPolicyVersion.count({ where: { organizationId: outsider.organizationId } })).resolves.toBe(0);
  });

  it('rejects malformed policy and tax values before persistence', async () => {
    const tenant = await createTenant(app, prisma);
    const policyRoute = `/api/v1/organizations/${tenant.organizationId}/pricing/policy-versions`;
    const taxRoute = `/api/v1/organizations/${tenant.organizationId}/pricing/tax-policy-versions`;
    await request(serverOf(app)).post(policyRoute).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `c3-policy-invalid-${randomUUID()}`).send({ ...pricingPolicyPayload(), allowedCurrencies: ['USD', 'USD'] }).expect(400);
    await request(serverOf(app)).post(policyRoute).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `c3-policy-invalid-${randomUUID()}`).send({ ...pricingPolicyPayload(), maxFxAgeSeconds: 0 }).expect(400);
    await request(serverOf(app)).post(taxRoute).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `c3-tax-invalid-${randomUUID()}`).send({ ...taxPolicyPayload(), rate: '-0.1' }).expect(400);
    await request(serverOf(app)).post(taxRoute).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `c3-tax-invalid-${randomUUID()}`).send({ ...taxPolicyPayload(), rate: '0.1234567890123456789' }).expect(400);
    await expect(prisma.pricingPolicyVersion.count({ where: { organizationId: tenant.organizationId } })).resolves.toBe(0);
    await expect(prisma.taxPolicyVersion.count({ where: { organizationId: tenant.organizationId } })).resolves.toBe(0);
  });

  it('creates a server-priced commercial quote and replays its immutable result idempotently', async () => {
    const tenant = await createTenant(app, prisma);
    const server = serverOf(app);
    const item = bodyOf<{ id: string }>(await request(server)
      .post(`/api/v1/organizations/${tenant.organizationId}/items`)
      .set('Authorization', `Bearer ${tenant.ownerToken}`)
      .send({ type: 'PRODUCT', name: `Quote item ${randomUUID()}`, unit: 'kg', referencePrice: '1', currency: 'USD' })
      .expect(201));
    const offer = bodyOf<{ id: string }>(await request(server)
      .post(`/api/v1/organizations/${tenant.organizationId}/catalog/offers`)
      .set('Authorization', `Bearer ${tenant.ownerToken}`)
      .set('Idempotency-Key', `quote-offer-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', itemId: item.id, sellUnitCode: 'KG' })
      .expect(201));
    await request(server)
      .post(`/api/v1/organizations/${tenant.organizationId}/catalog/offers/${offer.id}/price-versions`)
      .set('Authorization', `Bearer ${tenant.ownerToken}`)
      .set('Idempotency-Key', `quote-price-${randomUUID()}`)
      .send({ amount: '20', currencyCode: 'USD', priceUnitCode: 'KG' })
      .expect(201);
    await request(server)
      .post(`/api/v1/organizations/${tenant.organizationId}/pricing/policy-versions`)
      .set('Authorization', `Bearer ${tenant.ownerToken}`)
      .set('Idempotency-Key', `quote-policy-${randomUUID()}`)
      .send(pricingPolicyPayload())
      .expect(201);

    const route = `/api/v1/organizations/${tenant.organizationId}/pricing/quotes`;
    const key = `pricing-quote-${randomUUID()}`;
    const command = { productCode: 'MONARQUE_CONNECT', offerId: offer.id, quantity: '2', unitCode: 'KG', targetCurrency: 'USD' };
    const firstResponse = await request(server)
      .post(route)
      .set('Authorization', `Bearer ${tenant.ownerToken}`)
      .set('Idempotency-Key', key)
      .send(command)
      .expect(201);
    const first = bodyOf<{ id: string; organizationId: string; productCode: string; sourceCurrencyCode: string; targetCurrencyCode: string; sourceSubtotal: string; targetTotal: string }>(firstResponse);
    expect(first).toMatchObject({
      organizationId: tenant.organizationId,
      productCode: 'MONARQUE_CONNECT',
      sourceCurrencyCode: 'USD',
      targetCurrencyCode: 'USD',
      sourceSubtotal: '40.00',
      targetTotal: '40.00',
    });

    const replay = await request(server)
      .post(route)
      .set('Authorization', `Bearer ${tenant.ownerToken}`)
      .set('Idempotency-Key', key)
      .send(command)
      .expect(201);
    expect(replay.body).toEqual(first);
    await request(server)
      .post(route)
      .set('Authorization', `Bearer ${tenant.ownerToken}`)
      .set('Idempotency-Key', key)
      .send({ ...command, quantity: '3' })
      .expect(409);
  });
});

function pricingPolicyPayload(code = `POLICY_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`, productCode = 'MONARQUE_CONNECT') {
  return { productCode, code, roundingMode: 'HALF_UP', maxFxAgeSeconds: 86400, allowedCurrencies: ['CDF', 'USD'], allowedFxSources: ['TEST_FIXTURE'], discountRuleCodes: [], taxPolicyCodes: [] };
}

async function expectHttpStatus(responsePromise: PromiseLike<Response>, expectedStatus: number): Promise<Response> {
  const response = await responsePromise;
  expect(response.status, `Expected HTTP ${expectedStatus}, received ${response.status}: ${JSON.stringify(response.body)}`).toBe(expectedStatus);
  return response;
}

function taxPolicyPayload() {
  return { productCode: 'MONARQUE_CONNECT', code: `TAX_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`, jurisdictionCode: 'TEST-XX', taxCategoryCode: 'SYNTHETIC_STANDARD', rate: '0.16', calculationCurrency: 'SOURCE', effectiveFrom: new Date(Date.now() + 60_000).toISOString(), configurationReference: `synthetic-test-config:${randomUUID()}` };
}

async function createTenant(app: INestApplication, prisma: PrismaService): Promise<{ organizationId: string; ownerToken: string; ownerId: string }> {
  const server = serverOf(app);
  const owner = await registerAndLogin(server, `c3-policy-owner-${randomUUID()}@example.test`);
  const user = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: owner.email }, select: { id: true } });
  const organization = bodyOf<{ id: string }>(await request(server).post('/api/v1/organizations').set('Authorization', `Bearer ${owner.token}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'C3 Policy Tenant', handle: `c3-policy-${randomUUID().replaceAll('-', '').slice(0, 20)}`, defaultCurrency: 'USD', establishmentName: 'Main office' }).expect(201));
  return { organizationId: organization.id, ownerToken: owner.token, ownerId: user.id };
}

async function registerAndLogin(server: Parameters<typeof request>[0], email: string): Promise<{ token: string; email: string }> {
  const password = 'correct horse battery staple';
  const registration = bodyOf<{ email: string }>(await request(server).post('/api/v1/auth/register').send({ email, password, firstName: 'C3', lastName: 'Policy' }).expect(201));
  const login = bodyOf<{ accessToken: string }>(await request(server).post('/api/v1/auth/login').send({ identifier: registration.email, password }).expect(200));
  return { token: login.accessToken, email: registration.email };
}

function serverOf(app: INestApplication): Parameters<typeof request>[0] { return app.getHttpServer() as Parameters<typeof request>[0]; }
function bodyOf<T>(response: Response): T { return response.body as T; }
