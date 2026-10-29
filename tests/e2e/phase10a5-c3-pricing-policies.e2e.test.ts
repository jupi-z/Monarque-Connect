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

  it('creates and activates tenant/product/establishment tax contexts and explicitly classifies offers', async () => {
    const tenant = await createTenant(app, prisma);
    const server = serverOf(app);
    const establishment = await prisma.establishment.findFirstOrThrow({ where: { organizationId: tenant.organizationId, isPrimary: true }, select: { id: true } });
    const otherEstablishmentId = randomUUID();
    await prisma.establishment.create({ data: { id: otherEstablishmentId, organizationId: tenant.organizationId, code: `TAX-${randomUUID().slice(0, 8).toUpperCase()}`, name: 'Other tax scope', type: 'OFFICE' } });
    const route = `/api/v1/organizations/${tenant.organizationId}/pricing/tax-context-versions`;
    const defaultPayload = { productCode: 'MONARQUE_CONNECT', jurisdictionCode: 'TEST-XX', effectiveFrom: new Date(Date.now() + 60_000).toISOString() };
    await request(server).post(route).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `tax-context-product-denied-${randomUUID()}`)
      .send({ ...defaultPayload, productCode: 'ZAMUREK' }).expect(403);
    const contextKey = `tax-context-default-${randomUUID()}`;
    const draft = bodyOf<{ id: string; status: string; jurisdictionCode: string; establishmentId: string | null; version: number }>(await request(server)
      .post(route).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', contextKey).send(defaultPayload).expect(201));
    expect(draft).toMatchObject({ status: 'DRAFT', jurisdictionCode: 'TEST-XX', establishmentId: null, version: 1 });
    const replay = bodyOf<{ id: string }>(await request(server)
      .post(route).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', contextKey).send(defaultPayload).expect(201));
    expect(replay.id).toBe(draft.id);
    await request(server).post(route).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', contextKey).send({ ...defaultPayload, jurisdictionCode: 'TEST-YY' }).expect(409);

    const establishmentDraft = bodyOf<{ id: string; establishmentId: string }>(await request(server)
      .post(route).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `tax-context-site-${randomUUID()}`)
      .send({ ...defaultPayload, establishmentId: establishment.id }).expect(201));
    expect(establishmentDraft.establishmentId).toBe(establishment.id);

    const scopedAdmin = await registerAndLogin(server, `c3-tax-scoped-admin-${randomUUID()}@example.test`);
    const scopedAdminUser = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: scopedAdmin.email }, select: { id: true } });
    await prisma.membership.create({ data: {
      id: randomUUID(), organizationId: tenant.organizationId, userId: scopedAdminUser.id, role: 'ADMIN', scopeMode: 'SELECTED_ESTABLISHMENTS',
      scopeLinks: { create: [{ establishmentId: establishment.id }] },
    } });
    await request(server).post(route).set('Authorization', `Bearer ${scopedAdmin.token}`).set('Idempotency-Key', `tax-context-null-scope-${randomUUID()}`)
      .send({ ...defaultPayload, establishmentId: null }).expect(400);
    await request(server).post(route).set('Authorization', `Bearer ${scopedAdmin.token}`).set('Idempotency-Key', `tax-context-denied-scope-${randomUUID()}`)
      .send({ ...defaultPayload, establishmentId: otherEstablishmentId }).expect(403);
    const allowedScopedPayload = { ...defaultPayload, establishmentId: establishment.id, effectiveFrom: new Date(Date.now() + 120_000).toISOString() };
    await request(server).post(route).set('Authorization', `Bearer ${scopedAdmin.token}`).set('Idempotency-Key', `tax-context-allowed-scope-${randomUUID()}`)
      .send(allowedScopedPayload).expect(201);
    await expect(prisma.pricingTaxContextVersion.count({ where: { organizationId: tenant.organizationId, establishmentId: otherEstablishmentId } })).resolves.toBe(0);

    const activationRoute = `/api/v1/organizations/${tenant.organizationId}/pricing/tax-context-versions/${draft.id}/activate`;
    const acknowledgement = { acknowledgement: 'OWNER_REVIEWED_CONFIGURATION' };
    const sharedActivationKey = `tax-context-activate-race-${randomUUID()}`;
    const activationResponses = await Promise.all([
      request(server).post(activationRoute).query({ productCode: 'MONARQUE_CONNECT' }).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', sharedActivationKey).send(acknowledgement),
      request(server).post(`/api/v1/organizations/${tenant.organizationId}/pricing/tax-context-versions/${establishmentDraft.id}/activate`).query({ productCode: 'MONARQUE_CONNECT' }).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', sharedActivationKey).send(acknowledgement),
    ]);
    expect(activationResponses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winningActivation = bodyOf<{ id: string }>(activationResponses.find((response) => response.status === 200)!);
    expect([draft.id, establishmentDraft.id]).toContain(winningActivation.id);
    const rejectedVersionId = winningActivation.id === draft.id ? establishmentDraft.id : draft.id;
    await expect(prisma.pricingTaxContextVersion.findUniqueOrThrow({ where: { id: rejectedVersionId } }).then((value) => value.status)).resolves.toBe('DRAFT');
    await expect(prisma.auditEvent.count({ where: { organizationId: tenant.organizationId, targetType: 'PricingTaxContextVersion', targetId: rejectedVersionId, action: 'PRICING_TAX_CONTEXT_ACTIVATED' } })).resolves.toBe(0);
    await expect(prisma.outboxEvent.count({ where: { organizationId: tenant.organizationId, aggregateType: 'PricingTaxContextVersion', aggregateId: rejectedVersionId, eventType: 'pricing.tax_context_version.activated' } })).resolves.toBe(0);
    await expect(prisma.catalogCommandReceipt.count({
      where: {
        organizationId: tenant.organizationId,
        actorUserId: tenant.ownerId,
        operation: 'PRICING_TAX_CONTEXT_ACTIVATE',
        idempotencyKey: sharedActivationKey,
      },
    })).resolves.toBe(1);
    const activatedDraft = await prisma.pricingTaxContextVersion.findUniqueOrThrow({ where: { id: draft.id } });
    const activated = activatedDraft.status === 'ACTIVE'
      ? bodyOf<{ id: string; status: string; tenantReviewAcknowledgement: string }>(activationResponses.find((response) => response.status === 200)!)
      : bodyOf<{ id: string; status: string; tenantReviewAcknowledgement: string }>(await request(server)
        .post(activationRoute).query({ productCode: 'MONARQUE_CONNECT' }).set('Authorization', `Bearer ${tenant.ownerToken}`)
        .set('Idempotency-Key', `tax-context-activate-recovery-${randomUUID()}`).send(acknowledgement).expect(200));
    expect(activated).toMatchObject({ id: draft.id, status: 'ACTIVE', tenantReviewAcknowledgement: 'OWNER_REVIEWED_CONFIGURATION' });
    await expect(prisma.pricingTaxContextVersion.update({ where: { id: draft.id }, data: { jurisdictionCode: 'TEST-ZZ' } })).rejects.toThrow();
    await expect(prisma.pricingTaxContextVersion.delete({ where: { id: draft.id } })).rejects.toThrow();

    const item = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${tenant.organizationId}/items`)
      .set('Authorization', `Bearer ${tenant.ownerToken}`)
      .send({ type: 'PRODUCT', name: `Tax classified ${randomUUID()}`, unit: 'kg', referencePrice: '1', currency: 'USD' }).expect(201));
    const offer = bodyOf<{ id: string; version: number }>(await request(server).post(`/api/v1/organizations/${tenant.organizationId}/catalog/offers`)
      .set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `tax-offer-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', itemId: item.id, sellUnitCode: 'KG' }).expect(201));
    const sales = await registerAndLogin(server, `c3-tax-sales-${randomUUID()}@example.test`);
    const salesUser = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: sales.email }, select: { id: true } });
    await prisma.membership.create({ data: { id: randomUUID(), organizationId: tenant.organizationId, userId: salesUser.id, role: 'SALES', scopeMode: 'ALL_ESTABLISHMENTS' } });
    await request(server).put(`/api/v1/organizations/${tenant.organizationId}/catalog/offers/${offer.id}/tax-classification`)
      .set('Authorization', `Bearer ${sales.token}`).set('Idempotency-Key', `tax-classify-sales-denied-${randomUUID()}`)
      .send({ expectedVersion: offer.version, taxCategoryCode: 'SYNTHETIC_STANDARD' }).expect(403);
    const restrictedOffer = bodyOf<{ id: string; version: number }>(await request(server).post(`/api/v1/organizations/${tenant.organizationId}/catalog/offers`)
      .set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `tax-offer-restricted-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', itemId: item.id, sellUnitCode: 'KG', establishmentId: otherEstablishmentId }).expect(201));
    await request(server).put(`/api/v1/organizations/${tenant.organizationId}/catalog/offers/${restrictedOffer.id}/tax-classification`)
      .set('Authorization', `Bearer ${scopedAdmin.token}`).set('Idempotency-Key', `tax-classify-denied-scope-${randomUUID()}`)
      .send({ expectedVersion: restrictedOffer.version, taxCategoryCode: 'SYNTHETIC_STANDARD' }).expect(403);
    const classifyRoute = `/api/v1/organizations/${tenant.organizationId}/catalog/offers/${offer.id}/tax-classification`;
    const classificationKey = `tax-classify-${randomUUID()}`;
    const classification = { expectedVersion: offer.version, taxCategoryCode: 'SYNTHETIC_STANDARD' };
    const classified = bodyOf<{ taxCategoryCode: string | null; version: number }>(await request(server).put(classifyRoute)
      .set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', classificationKey).send(classification).expect(200));
    expect(classified).toMatchObject({ taxCategoryCode: 'SYNTHETIC_STANDARD', version: offer.version + 1 });
    await request(server).put(classifyRoute).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', classificationKey).send(classification).expect(200);
    await request(server).put(classifyRoute).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', classificationKey).send({ ...classification, taxCategoryCode: 'OTHER' }).expect(409);
    await request(server).put(classifyRoute).set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `tax-classify-stale-${randomUUID()}`).send(classification).expect(409);

    const otherTenant = await createTenant(app, prisma);
    await request(server).put(`/api/v1/organizations/${otherTenant.organizationId}/catalog/offers/${offer.id}/tax-classification`)
      .set('Authorization', `Bearer ${otherTenant.ownerToken}`).set('Idempotency-Key', `tax-cross-tenant-${randomUUID()}`)
      .send({ expectedVersion: classified.version, taxCategoryCode: 'SYNTHETIC_STANDARD' }).expect(404);
    await expect(prisma.auditEvent.count({ where: { organizationId: tenant.organizationId, targetType: 'PricingTaxContextVersion', targetId: draft.id, action: 'PRICING_TAX_CONTEXT_ACTIVATED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId: tenant.organizationId, aggregateType: 'PricingTaxContextVersion', aggregateId: draft.id, eventType: 'pricing.tax_context_version.activated' } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { organizationId: tenant.organizationId, targetType: 'CommercialOffer', targetId: offer.id, action: 'CATALOG_OFFER_TAX_CLASSIFICATION_CHANGED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId: tenant.organizationId, aggregateType: 'CommercialOffer', aggregateId: offer.id, eventType: 'catalog.offer.tax_classification_changed' } })).resolves.toBe(1);
  });

  it('resolves the establishment tax context before the organization default and snapshots exact tax inputs', async () => {
    const fixture = await createTaxQuoteFixture(app, prisma, { contexts: [
      { establishmentId: null, jurisdictionCode: 'TEST-DEFAULT' },
      { establishmentId: null, jurisdictionCode: 'TEST-SITE', establishment: true },
    ] });
    const defaultTaxCode = await createActiveTaxPolicy(serverOf(app), fixture.tenant, 'TEST-DEFAULT', '0.10');
    const siteTaxCode = await createActiveTaxPolicy(serverOf(app), fixture.tenant, 'TEST-SITE', '0.20');
    await createActivePricingPolicy(serverOf(app), fixture.tenant, [defaultTaxCode, siteTaxCode]);
    const offer = await createTaxableOffer(serverOf(app), fixture.tenant, fixture.itemId, true);

    const defaultQuote = bodyOf<TaxQuoteSnapshot>(await request(serverOf(app))
      .post(`/api/v1/organizations/${fixture.tenant.organizationId}/pricing/quotes`)
      .set('Authorization', `Bearer ${fixture.tenant.ownerToken}`)
      .set('Idempotency-Key', `tax-quote-default-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', offerId: offer.id, quantity: '2', unitCode: 'KG', targetCurrency: 'USD' })
      .expect(201));
    expect(defaultQuote).toMatchObject({ sourceTotal: '44.00', targetTotal: '44.00', taxCategoryCode: 'SYNTHETIC_STANDARD' });
    expect(defaultQuote.valuationAt).toBeTruthy();
    expect(defaultQuote.taxContext).toMatchObject({ jurisdictionCode: 'TEST-DEFAULT', establishmentId: null, version: 1 });
    expect(Date.parse(defaultQuote.taxContext?.effectiveFrom ?? '')).toBeGreaterThan(0);
    expect(defaultQuote.taxLines).toHaveLength(1);
    expect(defaultQuote.taxLines[0]).toMatchObject({ code: defaultTaxCode, rate: '0.100000000000000000', taxableBase: '40.00', amount: '4.00', currencyCode: 'USD', calculationCurrency: 'SOURCE' });
    expect(defaultQuote.taxPolicyVersionIds).toEqual([defaultQuote.taxLines[0]!.policyVersionId]);

    const siteQuote = bodyOf<TaxQuoteSnapshot>(await request(serverOf(app))
      .post(`/api/v1/organizations/${fixture.tenant.organizationId}/pricing/quotes`)
      .set('Authorization', `Bearer ${fixture.tenant.ownerToken}`)
      .set('Idempotency-Key', `tax-quote-site-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', offerId: offer.id, quantity: '2', unitCode: 'KG', targetCurrency: 'USD', establishmentId: fixture.establishmentId })
      .expect(201));
    expect(siteQuote).toMatchObject({ sourceTotal: '48.00', targetTotal: '48.00', establishmentId: fixture.establishmentId });
    expect(siteQuote.taxContext).toMatchObject({ jurisdictionCode: 'TEST-SITE', establishmentId: fixture.establishmentId, version: 1 });
    expect(Date.parse(siteQuote.taxContext?.effectiveFrom ?? '')).toBeGreaterThan(0);
    expect(siteQuote.taxLines).toHaveLength(1);
    expect(siteQuote.taxLines[0]).toMatchObject({ code: siteTaxCode, rate: '0.200000000000000000', taxableBase: '40.00', amount: '8.00', currencyCode: 'USD', calculationCurrency: 'SOURCE' });
  });

  it('fails closed without an explicit offer category or an effective tax context and creates no quote', async () => {
    const fixture = await createTaxQuoteFixture(app, prisma, { contexts: [{ establishmentId: null, jurisdictionCode: 'TEST-NO-CONTEXT', establishment: false }] });
    const taxCode = await createActiveTaxPolicy(serverOf(app), fixture.tenant, 'TEST-NO-CONTEXT', '0.16');
    await createActivePricingPolicy(serverOf(app), fixture.tenant, [taxCode]);
    const unclassified = await createTaxableOffer(serverOf(app), fixture.tenant, fixture.itemId, false);
    const route = `/api/v1/organizations/${fixture.tenant.organizationId}/pricing/quotes`;
    const quoteCountBefore = await prisma.pricingQuote.count({ where: { organizationId: fixture.tenant.organizationId } });
    await request(serverOf(app)).post(route).set('Authorization', `Bearer ${fixture.tenant.ownerToken}`).set('Idempotency-Key', `tax-no-category-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', offerId: unclassified.id, quantity: '1', unitCode: 'KG', targetCurrency: 'USD' }).expect(422);
    await expect(prisma.pricingQuote.count({ where: { organizationId: fixture.tenant.organizationId } })).resolves.toBe(quoteCountBefore);

    const contextless = await createTaxQuoteFixture(app, prisma, { contexts: [] });
    const contextlessTaxCode = await createActiveTaxPolicy(serverOf(app), contextless.tenant, 'TEST-MISSING-CONTEXT', '0.16');
    await createActivePricingPolicy(serverOf(app), contextless.tenant, [contextlessTaxCode]);
    const classified = await createTaxableOffer(serverOf(app), contextless.tenant, contextless.itemId, true);
    await request(serverOf(app)).post(`/api/v1/organizations/${contextless.tenant.organizationId}/pricing/quotes`)
      .set('Authorization', `Bearer ${contextless.tenant.ownerToken}`).set('Idempotency-Key', `tax-no-context-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', offerId: classified.id, quantity: '1', unitCode: 'KG', targetCurrency: 'USD' }).expect(422);
    await expect(prisma.pricingQuote.count({ where: { organizationId: contextless.tenant.organizationId } })).resolves.toBe(0);

    const mismatched = await createTaxQuoteFixture(app, prisma, { contexts: [{ establishmentId: null, jurisdictionCode: 'TEST-CONTEXT-JURISDICTION', establishment: false }] });
    const mismatchedTaxCode = await createActiveTaxPolicy(serverOf(app), mismatched.tenant, 'TEST-POLICY-JURISDICTION', '0.16');
    await createActivePricingPolicy(serverOf(app), mismatched.tenant, [mismatchedTaxCode]);
    const mismatchedOffer = await createTaxableOffer(serverOf(app), mismatched.tenant, mismatched.itemId, true);
    await request(serverOf(app)).post(`/api/v1/organizations/${mismatched.tenant.organizationId}/pricing/quotes`)
      .set('Authorization', `Bearer ${mismatched.tenant.ownerToken}`).set('Idempotency-Key', `tax-context-mismatch-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', offerId: mismatchedOffer.id, quantity: '1', unitCode: 'KG', targetCurrency: 'USD' }).expect(422);
    await expect(prisma.pricingQuote.count({ where: { organizationId: mismatched.tenant.organizationId } })).resolves.toBe(0);
  });

  it('calculates TARGET tax after the verified FX conversion and snapshots the target-currency base', async () => {
    const fixture = await createTaxQuoteFixture(app, prisma, { contexts: [{ establishmentId: null, jurisdictionCode: 'TEST-TARGET-TAX', establishment: false }] });
    const taxCode = await createActiveTaxPolicy(serverOf(app), fixture.tenant, 'TEST-TARGET-TAX', '0.10', undefined, undefined, 'TARGET');
    await createActivePricingPolicy(serverOf(app), fixture.tenant, [taxCode]);
    const offer = await createTaxableOffer(serverOf(app), fixture.tenant, fixture.itemId, true);
    const observedAt = new Date();
    await prisma.fxRate.create({ data: {
      id: randomUUID(), baseCurrencyCode: 'USD', quoteCurrencyCode: 'CDF', rate: '2360', sourceCode: 'TEST_FIXTURE',
      sourceReference: `target-tax-e2e-${randomUUID()}`, observedAt,
      validFrom: new Date(observedAt.getTime() - 1_000), validUntil: new Date(observedAt.getTime() + 86_400_000),
      commandPayloadHash: 'd'.repeat(64), ingestedByUserId: fixture.tenant.ownerId,
    } });

    const quote = bodyOf<TaxQuoteSnapshot>(await request(serverOf(app))
      .post(`/api/v1/organizations/${fixture.tenant.organizationId}/pricing/quotes`)
      .set('Authorization', `Bearer ${fixture.tenant.ownerToken}`).set('Idempotency-Key', `target-tax-quote-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', offerId: offer.id, quantity: '2', unitCode: 'KG', targetCurrency: 'CDF' }).expect(201));
    expect(quote).toMatchObject({ sourceTotal: null, targetTotal: '103840.00', taxCalculationCurrency: 'TARGET' });
    expect(quote.taxLines[0]).toMatchObject({ taxableBase: '94400.00', amount: '9440.00', currencyCode: 'CDF', calculationCurrency: 'TARGET' });
    expect(quote.fx?.appliedRate).toBe('2360.000000000000000000');
  });

  it('bounds quote validity by the next effective tax context and tax rule', async () => {
    const fixture = await createTaxQuoteFixture(app, prisma, { contexts: [{ establishmentId: null, jurisdictionCode: 'TEST-EXPIRY', establishment: false }] });
    const taxCode = await createActiveTaxPolicy(serverOf(app), fixture.tenant, 'TEST-EXPIRY', '0.10');
    await createActivePricingPolicy(serverOf(app), fixture.tenant, [taxCode]);
    const offer = await createTaxableOffer(serverOf(app), fixture.tenant, fixture.itemId, true);

    const contextEffectiveFrom = new Date(Date.now() + 360_000);
    await createAndActivateTaxContext(serverOf(app), prisma, fixture.tenant, null, 'TEST-EXPIRY-NEXT', contextEffectiveFrom);
    const policyEffectiveFrom = new Date(Date.now() + 300_000);
    await createActiveTaxPolicy(serverOf(app), fixture.tenant, 'TEST-EXPIRY', '0.12', policyEffectiveFrom.toISOString(), taxCode);

    const quote = bodyOf<TaxQuoteSnapshot>(await request(serverOf(app))
      .post(`/api/v1/organizations/${fixture.tenant.organizationId}/pricing/quotes`)
      .set('Authorization', `Bearer ${fixture.tenant.ownerToken}`).set('Idempotency-Key', `tax-quote-expiry-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', offerId: offer.id, quantity: '1', unitCode: 'KG', targetCurrency: 'USD' }).expect(201));
    expect(Date.parse(quote.expiresAt)).toBeLessThanOrEqual(policyEffectiveFrom.getTime());
    expect(Date.parse(quote.expiresAt)).toBeGreaterThan(Date.now());
    expect(quote.taxPolicyVersionIds).toHaveLength(1);
    expect(quote.taxLines[0]?.rate).toBe('0.100000000000000000');
  });

  it('creates immutable percentage discount versions and applies allowlisted discounts before tax', async () => {
    const fixture = await createTaxQuoteFixture(app, prisma, { contexts: [{ establishmentId: null, jurisdictionCode: 'TEST-DISCOUNT', establishment: false }] });
    const taxCode = await createActiveTaxPolicy(serverOf(app), fixture.tenant, 'TEST-DISCOUNT', '0.10');
    const discountCode = `DISC_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    const discountRoute = `/api/v1/organizations/${fixture.tenant.organizationId}/pricing/discount-rule-versions`;
    const discountKey = `discount-rule-${randomUUID()}`;
    const sales = await registerAndLogin(serverOf(app), `c3-discount-sales-${randomUUID()}@example.test`);
    const salesUser = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: sales.email }, select: { id: true } });
    await prisma.membership.create({ data: { id: randomUUID(), organizationId: fixture.tenant.organizationId, userId: salesUser.id, role: 'SALES', scopeMode: 'ALL_ESTABLISHMENTS', status: 'ACTIVE' } });
    const discountPayload = {
      productCode: 'MONARQUE_CONNECT', code: discountCode, rate: '15',
      configurationReference: `synthetic-test-discount:${randomUUID()}`,
    };
    await request(serverOf(app)).post(discountRoute).set('Authorization', `Bearer ${sales.token}`)
      .set('Idempotency-Key', `discount-rule-denied-${randomUUID()}`).send(discountPayload).expect(403);
    const createdRule = bodyOf<{ id: string; code: string; version: number; rate: string }>(await request(serverOf(app))
      .post(discountRoute).set('Authorization', `Bearer ${fixture.tenant.ownerToken}`).set('Idempotency-Key', discountKey)
      .send(discountPayload).expect(201));
    expect(createdRule).toMatchObject({ code: discountCode, version: 1, rate: '15.000000000000000000' });

    const replayedRule = bodyOf<{ id: string }>(await request(serverOf(app))
      .post(discountRoute).set('Authorization', `Bearer ${fixture.tenant.ownerToken}`).set('Idempotency-Key', discountKey)
      .send(discountPayload).expect(201));
    expect(replayedRule.id).toBe(createdRule.id);
    await request(serverOf(app)).post(discountRoute)
      .set('Authorization', `Bearer ${fixture.tenant.ownerToken}`).set('Idempotency-Key', discountKey)
      .send({ ...discountPayload, rate: '16' }).expect(409);
    await expect(prisma.catalogCommandReceipt.count({ where: { organizationId: fixture.tenant.organizationId, actorUserId: fixture.tenant.ownerId, resourceType: 'CommercialDiscountRuleVersion', resourceId: createdRule.id } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { organizationId: fixture.tenant.organizationId, targetType: 'CommercialDiscountRuleVersion', targetId: createdRule.id, action: 'PRICING_DISCOUNT_RULE_VERSION_CREATED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId: fixture.tenant.organizationId, aggregateType: 'CommercialDiscountRuleVersion', aggregateId: createdRule.id, eventType: 'pricing.discount_rule_version.created' } })).resolves.toBe(1);
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { organizationId: fixture.tenant.organizationId, aggregateType: 'CommercialDiscountRuleVersion', aggregateId: createdRule.id, eventType: 'pricing.discount_rule_version.created' } });
    expect(event.payloadJson).toMatchObject({ productCode: 'MONARQUE_CONNECT', code: discountCode, version: 1 });
    expect(event.payloadJson).not.toHaveProperty('rate');
    expect(event.payloadJson).not.toHaveProperty('configurationReference');
    await expect(prisma.commercialDiscountRuleVersion.update({ where: { id: createdRule.id }, data: { rate: '16' } })).rejects.toThrow();
    await expect(prisma.commercialDiscountRuleVersion.delete({ where: { id: createdRule.id } })).rejects.toThrow();

    const nextDiscountEffectiveFrom = new Date(Date.now() + 12 * 60_000).toISOString();
    const nextRule = bodyOf<{ version: number }>(await request(serverOf(app)).post(discountRoute)
      .set('Authorization', `Bearer ${fixture.tenant.ownerToken}`).set('Idempotency-Key', `discount-rule-next-${randomUUID()}`)
      .send({ ...discountPayload, rate: '30', effectiveFrom: nextDiscountEffectiveFrom }).expect(201));
    expect(nextRule.version).toBe(2);

    await createActivePricingPolicy(serverOf(app), fixture.tenant, [taxCode], [discountCode]);
    const offer = await createTaxableOffer(serverOf(app), fixture.tenant, fixture.itemId, true);
    const quote = bodyOf<TaxQuoteSnapshot>(await request(serverOf(app))
      .post(`/api/v1/organizations/${fixture.tenant.organizationId}/pricing/quotes`)
      .set('Authorization', `Bearer ${fixture.tenant.ownerToken}`).set('Idempotency-Key', `discount-quote-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', offerId: offer.id, quantity: '2', unitCode: 'KG', targetCurrency: 'USD' }).expect(201));
    expect(quote).toMatchObject({ snapshotVersion: 3, subtotal: '40.00', discountAmount: '6.00', netAmount: '34.00', sourceTotal: '37.40', targetTotal: '37.40' });
    expect(Date.parse(quote.expiresAt)).toBeLessThanOrEqual(Date.parse(nextDiscountEffectiveFrom));
    expect(quote.discounts).toEqual([{
      ruleVersionId: createdRule.id, ruleCode: discountCode, version: 1, rate: '15.000000000000000000', amount: '6.00', currencyCode: 'USD',
    }]);
    expect(quote.taxLines[0]).toMatchObject({ taxableBase: '34.00', amount: '3.40', currencyCode: 'USD' });
  });

  it('serializes concurrent identical discount version creation', async () => {
    const tenant = await createTenant(app, prisma);
    const code = `DISC_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    const effectiveFrom = new Date(Date.now() + 60_000).toISOString();
    const route = `/api/v1/organizations/${tenant.organizationId}/pricing/discount-rule-versions`;
    const submit = (suffix: string) => request(serverOf(app)).post(route)
      .set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `discount-race-${suffix}-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', code, rate: '12.5', effectiveFrom, configurationReference: 'synthetic-test-discount:race' });
    const [left, right] = await Promise.all([submit('left'), submit('right')]);
    expect([left.status, right.status].sort(), JSON.stringify([left.body, right.body])).toEqual([201, 409]);
    await expect(prisma.commercialDiscountRuleVersion.count({ where: { organizationId: tenant.organizationId, productCode: 'MONARQUE_CONNECT', code } })).resolves.toBe(1);
  });

  it('returns one immutable version and one audit trail for concurrent exact idempotent replays', async () => {
    const tenant = await createTenant(app, prisma);
    const code = `DISC_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    const route = `/api/v1/organizations/${tenant.organizationId}/pricing/discount-rule-versions`;
    const key = `discount-same-key-${randomUUID()}`;
    const command = { productCode: 'MONARQUE_CONNECT', code, rate: '7.25', configurationReference: 'synthetic-test-discount:concurrent-replay' };
    const submit = () => request(serverOf(app)).post(route)
      .set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', key).send(command);
    const [left, right] = await Promise.all([submit(), submit()]);
    expect([left.status, right.status].sort()).toEqual([201, 201]);
    const leftRule = bodyOf<{ id: string }>(left);
    const rightRule = bodyOf<{ id: string }>(right);
    expect(leftRule.id).toBe(rightRule.id);
    await expect(prisma.commercialDiscountRuleVersion.count({ where: { organizationId: tenant.organizationId, productCode: 'MONARQUE_CONNECT', code } })).resolves.toBe(1);
    await expect(prisma.catalogCommandReceipt.count({ where: { organizationId: tenant.organizationId, actorUserId: tenant.ownerId, operation: 'PRICING_DISCOUNT_RULE_VERSION_CREATE', idempotencyKey: key } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { organizationId: tenant.organizationId, targetType: 'CommercialDiscountRuleVersion', targetId: leftRule.id, action: 'PRICING_DISCOUNT_RULE_VERSION_CREATED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId: tenant.organizationId, aggregateType: 'CommercialDiscountRuleVersion', aggregateId: leftRule.id, eventType: 'pricing.discount_rule_version.created' } })).resolves.toBe(1);
  });

  it('rejects percentage discount rates above one hundred percent', async () => {
    const tenant = await createTenant(app, prisma);
    const payload = {
      productCode: 'MONARQUE_CONNECT', code: `DISC_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      rate: '100.000000000000000001', configurationReference: `synthetic-test-discount:${randomUUID()}`,
    };
    await request(serverOf(app)).post(`/api/v1/organizations/${tenant.organizationId}/pricing/discount-rule-versions`)
      .set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `discount-range-${randomUUID()}`)
      .send(payload).expect(400);
  });

  it('fails closed when an allowlisted discount is missing or combined rates exceed one hundred percent', async () => {
    const ruleOwner = await createTaxQuoteFixture(app, prisma, { contexts: [] });
    const missingCode = `DISC_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    await request(serverOf(app)).post(`/api/v1/organizations/${ruleOwner.tenant.organizationId}/pricing/discount-rule-versions`)
      .set('Authorization', `Bearer ${ruleOwner.tenant.ownerToken}`).set('Idempotency-Key', `discount-owner-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', code: missingCode, rate: '10', configurationReference: `synthetic-test-discount:${randomUUID()}` }).expect(201);

    const missing = await createTaxQuoteFixture(app, prisma, { contexts: [] });
    await createActivePricingPolicy(serverOf(app), missing.tenant, [], [missingCode]);
    const missingOffer = await createTaxableOffer(serverOf(app), missing.tenant, missing.itemId, false);
    await request(serverOf(app)).post(`/api/v1/organizations/${missing.tenant.organizationId}/pricing/quotes`)
      .set('Authorization', `Bearer ${missing.tenant.ownerToken}`).set('Idempotency-Key', `discount-missing-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', offerId: missingOffer.id, quantity: '1', unitCode: 'KG', targetCurrency: 'USD' }).expect(422);
    await expect(prisma.pricingQuote.count({ where: { organizationId: missing.tenant.organizationId } })).resolves.toBe(0);

    const overallocated = await createTaxQuoteFixture(app, prisma, { contexts: [] });
    const discountCodes = [`DISC_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`, `DISC_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`];
    for (const code of discountCodes) {
      await request(serverOf(app)).post(`/api/v1/organizations/${overallocated.tenant.organizationId}/pricing/discount-rule-versions`)
        .set('Authorization', `Bearer ${overallocated.tenant.ownerToken}`).set('Idempotency-Key', `discount-overallocated-${randomUUID()}`)
        .send({ productCode: 'MONARQUE_CONNECT', code, rate: '60', configurationReference: `synthetic-test-discount:${randomUUID()}` }).expect(201);
    }
    await createActivePricingPolicy(serverOf(app), overallocated.tenant, [], discountCodes);
    const overallocatedOffer = await createTaxableOffer(serverOf(app), overallocated.tenant, overallocated.itemId, false);
    await request(serverOf(app)).post(`/api/v1/organizations/${overallocated.tenant.organizationId}/pricing/quotes`)
      .set('Authorization', `Bearer ${overallocated.tenant.ownerToken}`).set('Idempotency-Key', `discount-overallocated-quote-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', offerId: overallocatedOffer.id, quantity: '1', unitCode: 'KG', targetCurrency: 'USD' }).expect(422);
    await expect(prisma.pricingQuote.count({ where: { organizationId: overallocated.tenant.organizationId } })).resolves.toBe(0);
  });

  it('revokes a quote once, atomically audits it, and preserves its immutable snapshot', async () => {
    const tenant = await createTenant(app, prisma);
    const server = serverOf(app);
    const item = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${tenant.organizationId}/items`)
      .set('Authorization', `Bearer ${tenant.ownerToken}`)
      .send({ type: 'PRODUCT', name: `Revocable quote item ${randomUUID()}`, unit: 'kg', referencePrice: '1', currency: 'USD' }).expect(201));
    const offer = await createTaxableOffer(server, tenant, item.id, false);
    await createActivePricingPolicy(server, tenant, [], []);
    const quoteRoute = `/api/v1/organizations/${tenant.organizationId}/pricing/quotes`;
    const createKey = `revocable-quote-create-${randomUUID()}`;
    const command = { productCode: 'MONARQUE_CONNECT', offerId: offer.id, quantity: '1', unitCode: 'KG', targetCurrency: 'USD' };
    const created = bodyOf<{ id: string; validity: string; targetTotal: string }>(await request(server).post(quoteRoute)
      .set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', createKey).send(command).expect(201));
    expect(created).toMatchObject({ validity: 'VALID', targetTotal: '20.00' });
    const storedSnapshot = await prisma.pricingQuote.findUniqueOrThrow({ where: { id: created.id }, select: { snapshotJson: true } });

    const sales = await registerAndLogin(server, `c3-revoke-sales-${randomUUID()}@example.test`);
    const salesUser = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: sales.email }, select: { id: true } });
    await prisma.membership.create({ data: { id: randomUUID(), organizationId: tenant.organizationId, userId: salesUser.id, role: 'SALES', scopeMode: 'ALL_ESTABLISHMENTS', status: 'ACTIVE' } });
    const revokePath = `/api/v1/organizations/${tenant.organizationId}/pricing/quotes/${created.id}/revoke`;
    const revoke = (auth: string, key: string, reasonCode = 'CUSTOMER_REQUEST') => request(server).post(revokePath)
      .query({ productCode: 'MONARQUE_CONNECT' }).set('Authorization', `Bearer ${auth}`).set('Idempotency-Key', key).send({ reasonCode });

    await revoke(sales.token, `sales-cannot-revoke-${randomUUID()}`).expect(403);
    const otherTenant = await createTenant(app, prisma);
    await request(server).post(`/api/v1/organizations/${otherTenant.organizationId}/pricing/quotes/${created.id}/revoke`)
      .query({ productCode: 'MONARQUE_CONNECT' }).set('Authorization', `Bearer ${otherTenant.ownerToken}`)
      .set('Idempotency-Key', `cross-tenant-revoke-${randomUUID()}`).send({ reasonCode: 'CUSTOMER_REQUEST' }).expect(404);
    await revoke(tenant.ownerToken, `invalid-reason-${randomUUID()}`, 'FREE_TEXT_REASON').expect(400);

    const revokeKey = `pricing-quote-revoke-${randomUUID()}`;
    const [left, right] = await Promise.all([revoke(tenant.ownerToken, revokeKey), revoke(tenant.ownerToken, revokeKey)]);
    type RevokedQuoteResponse = { id: string; validity: string; targetTotal: string; revokedAt: string; revocationReasonCode: string };
    const leftBody = bodyOf<RevokedQuoteResponse>(left);
    const rightBody = bodyOf<RevokedQuoteResponse>(right);
    expect([left.status, right.status].sort()).toEqual([200, 200]);
    expect(leftBody.id).toBe(created.id);
    expect(rightBody).toEqual(leftBody);
    expect(leftBody).toMatchObject({ ...created, validity: 'REVOKED', revocationReasonCode: 'CUSTOMER_REQUEST' });
    expect(Date.parse(leftBody.revokedAt)).toBeGreaterThan(0);
    await revoke(tenant.ownerToken, revokeKey, 'SECURITY_REVIEW').expect(409);
    await revoke(tenant.ownerToken, `second-revoke-${randomUUID()}`).expect(409);

    const readBack = await request(server).get(`${quoteRoute}/${created.id}`).query({ productCode: 'MONARQUE_CONNECT' })
      .set('Authorization', `Bearer ${tenant.ownerToken}`).expect(200);
    expect(readBack.body).toEqual(left.body);
    const createReplay = await request(server).post(quoteRoute).set('Authorization', `Bearer ${tenant.ownerToken}`)
      .set('Idempotency-Key', createKey).send(command).expect(201);
    expect(createReplay.body).toEqual(left.body);
    const persisted = await prisma.pricingQuote.findUniqueOrThrow({ where: { id: created.id }, select: { snapshotJson: true } });
    expect(persisted.snapshotJson).toEqual(storedSnapshot.snapshotJson);
    await expect(prisma.pricingQuote.update({ where: { id: created.id }, data: { snapshotJson: { tampered: true } } })).rejects.toThrow();
    const revocation = await prisma.pricingQuoteRevocation.findUniqueOrThrow({ where: { quoteId_organizationId: { quoteId: created.id, organizationId: tenant.organizationId } } });
    await expect(prisma.pricingQuoteRevocation.update({ where: { id: revocation.id }, data: { reasonCode: 'OTHER' } })).rejects.toThrow();
    await expect(prisma.pricingQuoteRevocation.delete({ where: { id: revocation.id } })).rejects.toThrow();
    await expect(prisma.catalogCommandReceipt.count({ where: { organizationId: tenant.organizationId, actorUserId: tenant.ownerId, operation: 'PRICING_QUOTE_REVOKE', idempotencyKey: revokeKey } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { organizationId: tenant.organizationId, targetType: 'PricingQuote', targetId: created.id, action: 'PRICING_QUOTE_REVOKED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId: tenant.organizationId, aggregateType: 'PricingQuote', aggregateId: created.id, eventType: 'pricing.quote.revoked' } })).resolves.toBe(1);
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { organizationId: tenant.organizationId, aggregateType: 'PricingQuote', aggregateId: created.id, eventType: 'pricing.quote.revoked' } });
    expect(event.payloadJson).toMatchObject({ quoteId: created.id, productCode: 'MONARQUE_CONNECT', revocationId: revocation.id });
    expect(event.payloadJson).not.toHaveProperty('reasonCode');
    expect(event.payloadJson).not.toHaveProperty('targetTotal');
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
    const first = bodyOf<{ id: string; organizationId: string; productCode: string; sourceCurrency: string; targetCurrency: string; subtotal: string; targetTotal: string; validity: string }>(firstResponse);
    expect(first).toMatchObject({
      organizationId: tenant.organizationId,
      productCode: 'MONARQUE_CONNECT',
      sourceCurrency: 'USD',
      targetCurrency: 'USD',
      subtotal: '40.00',
      targetTotal: '40.00',
      validity: 'VALID',
    });
    expect(await prisma.pricingQuote.count({ where: { organizationId: tenant.organizationId } })).toBe(1);
    expect(await prisma.pricingQuoteLine.count({ where: { organizationId: tenant.organizationId, quoteId: first.id } })).toBe(1);
    expect(await prisma.salesOrder.count({ where: { organizationId: tenant.organizationId } })).toBe(0);
    expect(await prisma.invoice.count({ where: { organizationId: tenant.organizationId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { organizationId: tenant.organizationId, targetType: 'PricingQuote', targetId: first.id, action: 'PRICING_QUOTE_CREATED' } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { organizationId: tenant.organizationId, aggregateType: 'PricingQuote', aggregateId: first.id, eventType: 'pricing.quote.created' } })).toBe(1);

    await request(server)
      .get(`${route}/${first.id}`)
      .query({ productCode: 'MONARQUE_CONNECT' })
      .set('Authorization', `Bearer ${tenant.ownerToken}`)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual(first));
    await request(server)
      .get(`${route}/${first.id}`)
      .query({ productCode: 'MONARQUE_CONNECT' })
      .expect(401);
    const otherTenant = await createTenant(app, prisma);
    await request(server)
      .get(`/api/v1/organizations/${otherTenant.organizationId}/pricing/quotes/${first.id}`)
      .query({ productCode: 'MONARQUE_CONNECT' })
      .set('Authorization', `Bearer ${otherTenant.ownerToken}`)
      .expect(404);

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
    await expect(prisma.pricingQuote.update({ where: { id: first.id }, data: { snapshotJson: { tampered: true } } })).rejects.toThrow();

    const fxOffer = bodyOf<{ id: string }>(await request(server)
      .post(`/api/v1/organizations/${tenant.organizationId}/catalog/offers`)
      .set('Authorization', `Bearer ${tenant.ownerToken}`)
      .set('Idempotency-Key', `quote-fx-offer-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', itemId: item.id, sellUnitCode: 'KG' })
      .expect(201));
    await request(server)
      .post(`/api/v1/organizations/${tenant.organizationId}/catalog/offers/${fxOffer.id}/price-versions`)
      .set('Authorization', `Bearer ${tenant.ownerToken}`)
      .set('Idempotency-Key', `quote-fx-price-${randomUUID()}`)
      .send({ amount: '20', currencyCode: 'USD', priceUnitCode: 'KG' })
      .expect(201);

    const observedAt = new Date();
    await prisma.fxRate.create({ data: {
      id: randomUUID(), baseCurrencyCode: 'USD', quoteCurrencyCode: 'CDF', rate: '2360',
      sourceCode: 'TEST_FIXTURE', sourceReference: `pricing-quote-e2e-${randomUUID()}`,
      observedAt, validFrom: new Date(observedAt.getTime() - 1_000), validUntil: new Date(observedAt.getTime() + 86_400_000),
      commandPayloadHash: 'a'.repeat(64), ingestedByUserId: tenant.ownerId,
    } });

    const converted = bodyOf<{
      quantityNormalized: { amount: string; baseUnitCode: string };
      subtotal: string;
      sourceCurrency: string;
      targetTotal: string;
      targetCurrency: string;
      fx: { rateId: string; appliedRate: string; direction: string; sourceReference: string };
    }>(await request(server)
      .post(route)
      .set('Authorization', `Bearer ${tenant.ownerToken}`)
      .set('Idempotency-Key', `pricing-quote-fx-${randomUUID()}`)
      .send({ productCode: 'MONARQUE_CONNECT', offerId: fxOffer.id, quantity: '125', unitCode: 'G', targetCurrency: 'CDF' })
      .expect(201));
    expect(converted).toMatchObject({
      quantityNormalized: { amount: '0.125', baseUnitCode: 'KG' },
      subtotal: '2.50',
      sourceCurrency: 'USD',
      targetTotal: '5900.00',
      targetCurrency: 'CDF',
      fx: { appliedRate: '2360.000000000000000000', direction: 'DIRECT' },
    });
    expect(converted.fx.rateId).toBeTruthy();
    expect(converted.fx.sourceReference).toMatch(/^pricing-quote-e2e-/);
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

function taxPolicyPayload(effectiveFrom: string | null = new Date(Date.now() + 60_000).toISOString()) {
  return { productCode: 'MONARQUE_CONNECT', code: `TAX_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`, jurisdictionCode: 'TEST-XX', taxCategoryCode: 'SYNTHETIC_STANDARD', rate: '0.16', calculationCurrency: 'SOURCE', ...(effectiveFrom ? { effectiveFrom } : {}), configurationReference: `synthetic-test-config:${randomUUID()}` };
}

type TaxQuoteSnapshot = {
  snapshotVersion: number;
  id: string;
  subtotal: string;
  discountAmount: string;
  netAmount: string;
  sourceTotal: string | null;
  targetTotal: string;
  valuationAt: string;
  expiresAt: string;
  establishmentId: string | null;
  taxCategoryCode: string | null;
  taxContext: { versionId: string; version: number; establishmentId: string | null; jurisdictionCode: string; effectiveFrom: string } | null;
  discounts: Array<{ ruleVersionId: string; ruleCode: string; version: number; rate: string; amount: string; currencyCode: string }>;
  taxLines: Array<{ policyVersionId: string; code: string; version: number; rate: string; taxableBase: string; amount: string; currencyCode: string; calculationCurrency: 'SOURCE' | 'TARGET' }>;
  taxPolicyVersionIds: string[];
  taxCalculationCurrency: 'SOURCE' | 'TARGET';
  fx: { appliedRate: string } | null;
};

async function createTaxQuoteFixture(
  app: INestApplication,
  prisma: PrismaService,
  options: { contexts: Array<{ establishmentId: string | null; jurisdictionCode: string; establishment?: boolean }> },
): Promise<{ tenant: { organizationId: string; ownerToken: string; ownerId: string }; establishmentId: string; itemId: string }> {
  const tenant = await createTenant(app, prisma);
  const server = serverOf(app);
  const primaryEstablishment = await prisma.establishment.findFirstOrThrow({
    where: { organizationId: tenant.organizationId, isPrimary: true }, select: { id: true },
  });
  for (const configured of options.contexts) {
    await createAndActivateTaxContext(
      server, prisma, tenant, configured.establishment ? primaryEstablishment.id : configured.establishmentId,
      configured.jurisdictionCode, new Date(Date.now() - 30_000),
    );
  }
  const item = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${tenant.organizationId}/items`)
    .set('Authorization', `Bearer ${tenant.ownerToken}`)
    .send({ type: 'PRODUCT', name: `Tax quote item ${randomUUID()}`, unit: 'kg', referencePrice: '1', currency: 'USD' }).expect(201));
  return { tenant, establishmentId: primaryEstablishment.id, itemId: item.id };
}

async function createAndActivateTaxContext(
  server: Parameters<typeof request>[0],
  prisma: PrismaService,
  tenant: { organizationId: string; ownerToken: string; ownerId: string },
  establishmentId: string | null,
  jurisdictionCode: string,
  effectiveFrom: Date,
): Promise<string> {
  const latest = await prisma.pricingTaxContextVersion.findFirst({
    where: { organizationId: tenant.organizationId, productCode: 'MONARQUE_CONNECT', establishmentId },
    orderBy: { version: 'desc' }, select: { version: true },
  });
  const id = randomUUID();
  await prisma.pricingTaxContextVersion.create({ data: {
    id, organizationId: tenant.organizationId, productCode: 'MONARQUE_CONNECT', establishmentId,
    version: (latest?.version ?? 0) + 1, status: 'DRAFT', jurisdictionCode, effectiveFrom,
    createdByUserId: tenant.ownerId, commandPayloadHash: 'c'.repeat(64),
  } });
  await request(server).post(`/api/v1/organizations/${tenant.organizationId}/pricing/tax-context-versions/${id}/activate`)
    .query({ productCode: 'MONARQUE_CONNECT' }).set('Authorization', `Bearer ${tenant.ownerToken}`)
    .set('Idempotency-Key', `tax-context-fixture-${randomUUID()}`)
    .send({ acknowledgement: 'OWNER_REVIEWED_CONFIGURATION' }).expect(200);
  return id;
}

async function createActiveTaxPolicy(
  server: Parameters<typeof request>[0],
  tenant: { organizationId: string; ownerToken: string },
  jurisdictionCode: string,
  rate: string,
  effectiveFrom?: string,
  code?: string,
  calculationCurrency: 'SOURCE' | 'TARGET' = 'SOURCE',
): Promise<string> {
  const payload = { ...taxPolicyPayload(effectiveFrom ?? null), ...(code ? { code } : {}), jurisdictionCode, rate, calculationCurrency };
  const route = `/api/v1/organizations/${tenant.organizationId}/pricing/tax-policy-versions`;
  const draft = bodyOf<{ id: string; code: string }>(await request(server).post(route)
    .set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `tax-policy-fixture-${randomUUID()}`)
    .send(payload).expect(201));
  await request(server).post(`${route}/${draft.id}/activate`).query({ productCode: 'MONARQUE_CONNECT' })
    .set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `tax-policy-activate-fixture-${randomUUID()}`)
    .send({ acknowledgement: 'OWNER_REVIEWED_CONFIGURATION' }).expect(200);
  return draft.code;
}

async function createActivePricingPolicy(
  server: Parameters<typeof request>[0],
  tenant: { organizationId: string; ownerToken: string },
  taxPolicyCodes: string[],
  discountRuleCodes: string[] = [],
): Promise<void> {
  await request(server).post(`/api/v1/organizations/${tenant.organizationId}/pricing/policy-versions`)
    .set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `tax-pricing-policy-fixture-${randomUUID()}`)
    .send({ ...pricingPolicyPayload(), taxPolicyCodes, discountRuleCodes }).expect(201);
}

async function createTaxableOffer(
  server: Parameters<typeof request>[0],
  tenant: { organizationId: string; ownerToken: string },
  itemId: string,
  classify: boolean,
): Promise<{ id: string }> {
  const offer = bodyOf<{ id: string; version: number }>(await request(server).post(`/api/v1/organizations/${tenant.organizationId}/catalog/offers`)
    .set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `taxable-offer-${randomUUID()}`)
    .send({ productCode: 'MONARQUE_CONNECT', itemId, sellUnitCode: 'KG' }).expect(201));
  await request(server).post(`/api/v1/organizations/${tenant.organizationId}/catalog/offers/${offer.id}/price-versions`)
    .set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `taxable-price-${randomUUID()}`)
    .send({ amount: '20', currencyCode: 'USD', priceUnitCode: 'KG' }).expect(201);
  if (classify) {
    await request(server).put(`/api/v1/organizations/${tenant.organizationId}/catalog/offers/${offer.id}/tax-classification`)
      .set('Authorization', `Bearer ${tenant.ownerToken}`).set('Idempotency-Key', `taxable-classification-${randomUUID()}`)
      .send({ expectedVersion: offer.version, taxCategoryCode: 'SYNTHETIC_STANDARD' }).expect(200);
  }
  return { id: offer.id };
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
