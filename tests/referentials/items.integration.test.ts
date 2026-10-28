import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPair } from 'node:crypto';
import { randomUUID } from 'node:crypto';
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

describe('Catalog items referential', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let viewerToken = '';
  let organizationId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = connectionString;
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-test';
    process.env.JWT_AUDIENCE = 'monarque-connect-api-test';
    process.env.JWT_KEY_ID = 'phase3-items-test';
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

    const registration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: 'phase3-items-owner@example.com', password: 'correct horse battery staple', firstName: 'Phase', lastName: 'Owner' }).expect(201);
    const login = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(registration).email, password: 'correct horse battery staple' }).expect(200);
    ownerToken = bodyOf<{ accessToken: string }>(login).accessToken;
    const organization = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Phase 3 Catalog Tenant', handle: `phase3-items-${Date.now()}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
    organizationId = bodyOf<{ id: string }>(organization).id;
    const operationsVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'OPERATIONS', version: 1 } } });
    await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: operationsVersion.id, startsAt: new Date('2020-01-01T00:00:00.000Z') } });
    const viewerRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: 'phase3-items-viewer@example.com', password: 'correct horse battery staple', firstName: 'Catalog', lastName: 'Viewer' }).expect(201);
    const viewerLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(viewerRegistration).email, password: 'correct horse battery staple' }).expect(200);
    viewerToken = bodyOf<{ accessToken: string }>(viewerLogin).accessToken;
    const viewer = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: 'phase3-items-viewer@example.com' } });
    await prisma.membership.create({ data: { id: crypto.randomUUID(), organizationId, userId: viewer.id, role: 'VIEWER', scopeMode: 'ALL_ESTABLISHMENTS' } });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('creates and lists a product with decimal price serialization and atomic events', async () => {
    const sku = `SKU-${randomUUID()}`;
    const created = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', sku, name: 'Widget', unit: 'piece', referencePrice: '12.3400', currency: 'EUR', trackInventory: true }).expect(201);
    const item = bodyOf<{ id: string; organizationId: string; type: string; referencePrice: string; currency: string; trackInventory: boolean }>(created);
    expect(item).toMatchObject({ organizationId, type: 'PRODUCT', referencePrice: '12.3400', currency: 'EUR', trackInventory: true });

    const listed = await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/items?type=PRODUCT&active=true`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ items: Array<{ id: string }> }>(listed).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: item.id })]));
    await expect(prisma.auditEvent.findFirst({ where: { targetType: 'Item', targetId: item.id, action: 'CATALOG_ITEM_CREATED' } })).resolves.not.toBeNull();
    await expect(prisma.outboxEvent.findFirst({ where: { aggregateType: 'Item', aggregateId: item.id, eventType: 'catalog.item.created' } })).resolves.not.toBeNull();
  });

  it('enforces SKU uniqueness and soft status transitions', async () => {
    const sku = `SKU-${randomUUID()}`;
    const created = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'SERVICE', sku, name: 'Consulting', unit: 'hour', referencePrice: '20', currency: 'EUR' }).expect(201);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'SERVICE', sku, name: 'Duplicate', unit: 'hour', referencePrice: '20', currency: 'EUR' }).expect(409);
    const item = bodyOf<{ id: string; active: boolean }>(created);
    const deactivated = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items/${item.id}/deactivate`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ active: boolean }>(deactivated).active).toBe(false);
    const repeated = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items/${item.id}/deactivate`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ active: boolean }>(repeated).active).toBe(false);
    await expect(prisma.auditEvent.count({ where: { targetType: 'Item', targetId: item.id, action: 'CATALOG_ITEM_STATUS_CHANGED' } })).resolves.toBe(1);
  });

  it('excludes inactive items by default while allowing an explicit inactive filter', async () => {
    const server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
    const created = await request(server).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'SERVICE', name: 'Inactive item', unit: 'hour', referencePrice: '20', currency: 'EUR' }).expect(201);
    const itemId = bodyOf<{ id: string }>(created).id;
    await request(server).post(`/api/v1/organizations/${organizationId}/items/${itemId}/deactivate`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const defaultList = await request(server).get(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const inactiveList = await request(server).get(`/api/v1/organizations/${organizationId}/items?active=false`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ items: Array<{ id: string }> }>(defaultList).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: itemId })]));
    expect(bodyOf<{ items: Array<{ id: string }> }>(inactiveList).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: itemId })]));
  });

  it('emits one status event for concurrent item deactivation requests', async () => {
    const server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
    const created = await request(server).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'SERVICE', name: 'Concurrent item', unit: 'hour', referencePrice: '20', currency: 'EUR' }).expect(201);
    const itemId = bodyOf<{ id: string }>(created).id;
    const responses = await Promise.all([
      request(server).post(`/api/v1/organizations/${organizationId}/items/${itemId}/deactivate`).set('Authorization', `Bearer ${ownerToken}`),
      request(server).post(`/api/v1/organizations/${organizationId}/items/${itemId}/deactivate`).set('Authorization', `Bearer ${ownerToken}`),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    await expect(prisma.auditEvent.count({ where: { targetType: 'Item', targetId: itemId, action: 'CATALOG_ITEM_STATUS_CHANGED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { aggregateType: 'Item', aggregateId: itemId, eventType: 'catalog.item.status_changed' } })).resolves.toBe(1);
  });

  it('rejects item creation when CATALOG is disabled', async () => {
    await prisma.organizationModuleActivation.upsert({ where: { organizationId_productCode_moduleCode: { productCode: 'MONARQUE_CONNECT', organizationId, moduleCode: 'CATALOG' } }, update: { enabled: false }, create: { id: crypto.randomUUID(), organizationId, moduleCode: 'CATALOG', enabled: false } });
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', name: 'Blocked', unit: 'piece', referencePrice: '1', currency: 'EUR' }).expect(403);
    await prisma.organizationModuleActivation.update({ where: { organizationId_productCode_moduleCode: { productCode: 'MONARQUE_CONNECT', organizationId, moduleCode: 'CATALOG' } }, data: { enabled: true } });
  });

  it('rejects a role without catalog write permission', async () => {
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${viewerToken}`).send({ type: 'PRODUCT', name: 'Role blocked', unit: 'piece', referencePrice: '1', currency: 'EUR' }).expect(403);
  });

  it('lets PostgreSQL decide one winner for concurrent duplicate SKUs', async () => {
    const responses = await Promise.all([
      request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', sku: 'RACE-SKU', name: 'Race one', unit: 'piece', referencePrice: '1', currency: 'EUR' }),
      request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', sku: 'RACE-SKU', name: 'Race two', unit: 'piece', referencePrice: '1', currency: 'EUR' }),
    ]);
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
  });

  it('serves authenticated versioned measure and currency registries without changing tenant currency', async () => {
    const server = serverOf(app);
    await request(server).get('/api/v1/catalog/measure-units').expect(401);
    await request(server).get('/api/v1/catalog/currencies').expect(401);
    const measures = bodyOf<{ version: string; items: Array<{ code: string; baseUnitCode: string; numerator: string; denominator: string }> }>(await request(server).get('/api/v1/catalog/measure-units').set('Authorization', `Bearer ${ownerToken}`).expect(200));
    const gram = measures.items.find((unit) => unit.code === 'G');
    expect(measures.version).toBe('measure-units-v1');
    expect(gram).toMatchObject({ baseUnitCode: 'KG', numerator: '1', denominator: '1000' });
    const currencies = bodyOf<{ version: string; items: Array<{ code: string; minorUnitDigits: number; registryVersion: number; sourceRevision: string }> }>(await request(server).get('/api/v1/catalog/currencies').set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(currencies.items).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CDF', minorUnitDigits: 2, registryVersion: 1, sourceRevision: 'six-iso4217-list-one-2026-10' })]));
    await expect(prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { defaultCurrency: true } })).resolves.toMatchObject({ defaultCurrency: 'EUR' });
  });

  it('creates tenant-scoped variants and product-scoped offers with replay-safe idempotency', async () => {
    const server = serverOf(app);
    const item = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', name: 'Weighted product', unit: 'kg', referencePrice: '20', currency: 'USD' }).expect(201));
    const variantResponse = await request(server).post(`/api/v1/organizations/${organizationId}/catalog/items/${item.id}/variants`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'variant-create-1').send({ productCode: 'MONARQUE_CONNECT', code: 'RED', displayName: 'Red', attributes: { color: 'red' } }).expect(201);
    const variant = bodyOf<{ id: string; itemId: string; status: string; attributes: Record<string, string> }>(variantResponse);
    expect(variant).toMatchObject({ itemId: item.id, status: 'ACTIVE', attributes: { color: 'red' } });
    const replayedVariant = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/catalog/items/${item.id}/variants`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'variant-create-1').send({ productCode: 'MONARQUE_CONNECT', code: 'RED', displayName: 'Red', attributes: { color: 'red' } }).expect(201));
    expect(replayedVariant.id).toBe(variant.id);
    await request(server).post(`/api/v1/organizations/${organizationId}/catalog/items/${item.id}/variants`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'variant-create-1').send({ productCode: 'MONARQUE_CONNECT', code: 'RED', displayName: 'Blue', attributes: { color: 'blue' } }).expect(409);

    const offerInput = { productCode: 'MONARQUE_CONNECT', itemId: item.id, variantId: variant.id, sellUnitCode: 'KG', displayName: 'Red weighted product' };
    const offer = bodyOf<{ id: string; organizationId: string; productCode: string; itemId: string; variantId: string; sellUnitCode: string; version: number }>(await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'offer-create-1').send(offerInput).expect(201));
    expect(offer).toMatchObject({ organizationId, productCode: 'MONARQUE_CONNECT', itemId: item.id, variantId: variant.id, sellUnitCode: 'KG', version: 1 });
    const replayedOffer = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'offer-create-1').send(offerInput).expect(201));
    expect(replayedOffer.id).toBe(offer.id);

    await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'offer-zamurek-denied').send({ ...offerInput, productCode: 'ZAMUREK' }).expect(403);
    await request(server).patch(`/api/v1/organizations/${organizationId}/catalog/offers/${offer.id}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'offer-update-1').send({ expectedVersion: 1, status: 'INACTIVE' }).expect(200);
    await request(server).get(`/api/v1/organizations/${organizationId}/catalog/offers?productCode=MONARQUE_CONNECT`).set('Authorization', `Bearer ${ownerToken}`).expect(200).expect((response) => {
      expect(bodyOf<{ items: Array<{ id: string }> }>(response).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: offer.id })]));
    });
    await expect(prisma.auditEvent.count({ where: { targetId: variant.id, action: 'CATALOG_VARIANT_CREATED' } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { targetId: offer.id, action: { in: ['CATALOG_OFFER_CREATED', 'CATALOG_OFFER_STATUS_CHANGED'] } } })).resolves.toBe(2);
    await expect(prisma.outboxEvent.count({ where: { aggregateId: offer.id, eventType: { in: ['catalog.offer.created', 'catalog.offer.status_changed'] } } })).resolves.toBe(2);
  });

  it('does not list or reactivate offers whose item or variant is inactive', async () => {
    const server = serverOf(app);
    const item = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', name: 'Deactivatable offer item', unit: 'kg', referencePrice: '1', currency: 'EUR' }).expect(201));
    const variant = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/catalog/items/${item.id}/variants`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `variant-${randomUUID()}`).send({ productCode: 'MONARQUE_CONNECT', code: `VAR-${randomUUID().slice(0, 8)}` }).expect(201));
    const offer = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `offer-${randomUUID()}`).send({ productCode: 'MONARQUE_CONNECT', itemId: item.id, variantId: variant.id, sellUnitCode: 'KG' }).expect(201));
    await prisma.itemVariant.update({ where: { id: variant.id }, data: { active: false } });
    const listedWithInactiveVariant = bodyOf<{ items: Array<{ id: string }> }>(await request(server).get(`/api/v1/organizations/${organizationId}/catalog/offers?productCode=MONARQUE_CONNECT`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(listedWithInactiveVariant.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: offer.id })]));
    await request(server).patch(`/api/v1/organizations/${organizationId}/catalog/offers/${offer.id}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `reactivate-${randomUUID()}`).send({ expectedVersion: 1, status: 'INACTIVE' }).expect(200);
    await request(server).patch(`/api/v1/organizations/${organizationId}/catalog/offers/${offer.id}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `reactivate-${randomUUID()}`).send({ expectedVersion: 2, status: 'ACTIVE' }).expect(409);

    const itemOffer = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `item-offer-${randomUUID()}`).send({ productCode: 'MONARQUE_CONNECT', itemId: item.id, sellUnitCode: 'KG' }).expect(201));
    await request(server).post(`/api/v1/organizations/${organizationId}/items/${item.id}/deactivate`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    await request(server).patch(`/api/v1/organizations/${organizationId}/catalog/offers/${itemOffer.id}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `item-deactivate-${randomUUID()}`).send({ expectedVersion: 1, status: 'INACTIVE' }).expect(200);
    await request(server).patch(`/api/v1/organizations/${organizationId}/catalog/offers/${itemOffer.id}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `item-reactivate-${randomUUID()}`).send({ expectedVersion: 2, status: 'ACTIVE' }).expect(409);
    const listedWithInactiveItem = bodyOf<{ items: Array<{ id: string }> }>(await request(server).get(`/api/v1/organizations/${organizationId}/catalog/offers?productCode=MONARQUE_CONNECT`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(listedWithInactiveItem.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: itemOffer.id })]));
  });

  it('does not list or reactivate offers whose registered selling unit is inactive', async () => {
    const server = serverOf(app);
    const item = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'SERVICE', name: 'Inactive unit service', unit: 'hour', referencePrice: '1', currency: 'EUR' }).expect(201));
    const unique = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
    const unitCode = `TEST_${unique}`;
    const idempotencyKey = `unit-offer-${unique}`;
    await prisma.measureUnit.create({ data: { code: unitCode, displayName: 'Temporary test time unit', dimension: 'TIME', baseUnitCode: 'HOUR', numerator: 1n, denominator: 1n, registryVersion: 1, sourceRevision: `test-${unique}` } });
    let offerId: string | undefined;
    try {
      offerId = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', idempotencyKey).send({ productCode: 'MONARQUE_CONNECT', itemId: item.id, sellUnitCode: unitCode }).expect(201)).id;
      await prisma.measureUnit.update({ where: { code: unitCode }, data: { active: false } });
      const listed = bodyOf<{ items: Array<{ id: string }> }>(await request(server).get(`/api/v1/organizations/${organizationId}/catalog/offers?productCode=MONARQUE_CONNECT`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
      expect(listed.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: offerId })]));
      await request(server).patch(`/api/v1/organizations/${organizationId}/catalog/offers/${offerId}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `unit-offer-inactive-${unique}`).send({ expectedVersion: 1, status: 'INACTIVE' }).expect(200);
      await request(server).patch(`/api/v1/organizations/${organizationId}/catalog/offers/${offerId}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `unit-offer-reactivate-${unique}`).send({ expectedVersion: 2, status: 'ACTIVE' }).expect(409);
    } finally {
      await prisma.$transaction(async (tx) => {
        if (offerId) {
          await tx.catalogCommandReceipt.deleteMany({ where: { organizationId, resourceId: offerId } });
          await tx.auditEvent.deleteMany({ where: { targetId: offerId } });
          await tx.outboxEvent.deleteMany({ where: { aggregateId: offerId } });
          await tx.commercialOffer.deleteMany({ where: { id: offerId, organizationId } });
        } else {
          await tx.catalogCommandReceipt.deleteMany({ where: { organizationId, idempotencyKey } });
        }
        await tx.item.deleteMany({ where: { id: item.id, organizationId } });
        await tx.measureUnit.delete({ where: { code: unitCode } });
      });
    }
  });

  it('uses optimistic concurrency so only one competing offer update is applied', async () => {
    const server = serverOf(app);
    const item = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'SERVICE', name: 'Concurrent offer service', unit: 'hour', referencePrice: '1', currency: 'EUR' }).expect(201));
    const offer = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `concurrent-offer-${randomUUID()}`).send({ productCode: 'MONARQUE_CONNECT', itemId: item.id, sellUnitCode: 'HOUR' }).expect(201));
    const responses = await Promise.all([
      request(server).patch(`/api/v1/organizations/${organizationId}/catalog/offers/${offer.id}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `concurrent-update-a-${randomUUID()}`).send({ expectedVersion: 1, displayName: 'Concurrent A' }),
      request(server).patch(`/api/v1/organizations/${organizationId}/catalog/offers/${offer.id}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `concurrent-update-b-${randomUUID()}`).send({ expectedVersion: 1, displayName: 'Concurrent B' }),
    ]);
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 409]);
    await expect(prisma.commercialOffer.findUniqueOrThrow({ where: { id: offer.id }, select: { version: true } })).resolves.toEqual({ version: 2 });
    await expect(prisma.outboxEvent.count({ where: { aggregateId: offer.id, eventType: 'catalog.offer.updated' } })).resolves.toBe(1);
  });

  it('limits channel-specific offers to their channel and rejects blank update names', async () => {
    const server = serverOf(app);
    const item = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'SERVICE', name: 'Channel offer service', unit: 'hour', referencePrice: '1', currency: 'EUR' }).expect(201));
    const channelOffer = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `channel-offer-${randomUUID()}`).send({ productCode: 'MONARQUE_CONNECT', itemId: item.id, sellUnitCode: 'HOUR', channelCode: 'POS' }).expect(201));
    const publicList = bodyOf<{ items: Array<{ id: string }> }>(await request(server).get(`/api/v1/organizations/${organizationId}/catalog/offers?productCode=MONARQUE_CONNECT`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(publicList.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: channelOffer.id })]));
    const globalOffer = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `global-offer-${randomUUID()}`).send({ productCode: 'MONARQUE_CONNECT', itemId: item.id, sellUnitCode: 'HOUR' }).expect(201));
    const posList = bodyOf<{ items: Array<{ id: string }> }>(await request(server).get(`/api/v1/organizations/${organizationId}/catalog/offers?productCode=MONARQUE_CONNECT&channelCode=POS`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(posList.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: channelOffer.id }), expect.objectContaining({ id: globalOffer.id })]));
    await request(server).patch(`/api/v1/organizations/${organizationId}/catalog/offers/${channelOffer.id}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `blank-name-${randomUUID()}`).send({ expectedVersion: 1, displayName: '   ' }).expect(400);
  });

  it('rejects an offer that references an item owned by another organization', async () => {
    const server = serverOf(app);
    const foreignOrganization = bodyOf<{ id: string }>(await request(server).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Separate catalog tenant', handle: `phase3-foreign-${randomUUID().slice(0, 8)}`, defaultCurrency: 'EUR', establishmentName: 'Foreign office' }).expect(201));
    const foreignItem = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${foreignOrganization.id}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', name: 'Foreign item', unit: 'kg', referencePrice: '1', currency: 'EUR' }).expect(201));
    await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `cross-tenant-${randomUUID()}`).send({ productCode: 'MONARQUE_CONNECT', itemId: foreignItem.id, sellUnitCode: 'KG' }).expect(404);
  });

  it('publishes immutable tenant price versions with authorization, idempotency and temporal ordering', async () => {
    const server = serverOf(app);
    const item = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', name: `Priced item ${randomUUID()}`, unit: 'kg', referencePrice: '1', currency: 'USD' }).expect(201));
    const offer = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `price-offer-${randomUUID()}`).send({ productCode: 'MONARQUE_CONNECT', itemId: item.id, sellUnitCode: 'KG' }).expect(201));
    const path = `/api/v1/organizations/${organizationId}/catalog/offers/${offer.id}/price-versions`;
    const key = `price-publish-${randomUUID()}`;
    const command = { amount: '20', currencyCode: 'USD', priceUnitCode: 'KG' };

    await request(server).post(path).set('Idempotency-Key', `anonymous-${randomUUID()}`).send(command).expect(401);
    await request(server).post(path).set('Authorization', `Bearer ${viewerToken}`).set('Idempotency-Key', `viewer-${randomUUID()}`).send(command).expect(403);
    const first = bodyOf<{ id: string; offerId: string; amount: string; currencyCode: string; priceUnitCode: string; version: number }>(
      await request(server).post(path).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', key).send(command).expect(201),
    );
    expect(first).toMatchObject({ offerId: offer.id, amount: '20.00000000', currencyCode: 'USD', priceUnitCode: 'KG', version: 1 });
    const replay = bodyOf<{ id: string }>(await request(server).post(path).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', key).send(command).expect(201));
    expect(replay.id).toBe(first.id);
    await request(server).post(path).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', key).send({ ...command, amount: '21' }).expect(409);
    await request(server).post(path).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `backdate-${randomUUID()}`).send({ ...command, effectiveFrom: '2020-01-01T00:00:00.000Z' }).expect(400);
    await request(server).post(path).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `wrong-unit-${randomUUID()}`).send({ ...command, priceUnitCode: 'L' }).expect(400);

    const future = new Date(Date.now() + 60_000).toISOString();
    const second = bodyOf<{ id: string; version: number }>(await request(server).post(path).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `future-${randomUUID()}`).send({ ...command, amount: '22', effectiveFrom: future, expectedLatestVersionId: first.id }).expect(201));
    expect(second.version).toBe(2);
    await expect(prisma.commercialPriceVersion.count({ where: { organizationId, offerId: offer.id, currencyCode: 'USD' } })).resolves.toBe(2);
    await expect(prisma.auditEvent.count({ where: { organizationId, targetType: 'CommercialPriceVersion', action: 'COMMERCIAL_PRICE_VERSION_PUBLISHED' } })).resolves.toBe(2);
    await expect(prisma.outboxEvent.count({ where: { organizationId, aggregateType: 'CommercialPriceVersion', eventType: 'catalog.price_version.published' } })).resolves.toBe(2);
    await expect(prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: first.id, eventType: 'catalog.price_version.published' }, select: { payloadJson: true } })).resolves.not.toHaveProperty('payloadJson.amount');
    await expect(prisma.commercialPriceVersion.update({ where: { id: first.id }, data: { amount: '99' } })).rejects.toThrow();
    await expect(prisma.commercialPriceVersion.delete({ where: { id: second.id } })).rejects.toThrow();
  });

  it('does not publish a foreign tenant offer through a caller-selected organization path', async () => {
    const server = serverOf(app);
    const foreignOrganization = bodyOf<{ id: string }>(await request(server).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({
      businessTypeCode: 'SERVICE_PROVIDER', name: 'Foreign price tenant', handle: `price-foreign-${randomUUID().slice(0, 8)}`,
      defaultCurrency: 'EUR', establishmentName: 'Foreign office',
    }).expect(201));
    const operationsVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'OPERATIONS', version: 1 } } });
    await prisma.subscription.updateMany({ where: { organizationId: foreignOrganization.id }, data: { planVersionId: operationsVersion.id, startsAt: new Date('2020-01-01T00:00:00.000Z') } });
    const foreignItem = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${foreignOrganization.id}/items`).set('Authorization', `Bearer ${ownerToken}`).send({
      type: 'PRODUCT', name: `Foreign price item ${randomUUID()}`, unit: 'kg', referencePrice: '1', currency: 'USD',
    }).expect(201));
    const foreignOffer = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${foreignOrganization.id}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `foreign-price-offer-${randomUUID()}`).send({
      productCode: 'MONARQUE_CONNECT', itemId: foreignItem.id, sellUnitCode: 'KG',
    }).expect(201));

    await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers/${foreignOffer.id}/price-versions`)
      .set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `cross-tenant-price-${randomUUID()}`)
      .send({ amount: '20', currencyCode: 'USD', priceUnitCode: 'KG' }).expect(404);
    await expect(prisma.commercialPriceVersion.count({ where: { offerId: foreignOffer.id } })).resolves.toBe(0);
  });

  it('enforces establishment scope when publishing a price version', async () => {
    const server = serverOf(app);
    const primary = await prisma.establishment.findFirstOrThrow({ where: { organizationId, isPrimary: true } });
    const restrictedEstablishment = await prisma.establishment.create({ data: {
      id: randomUUID(), organizationId, code: `PRICE-SCOPE-${randomUUID().slice(0, 8)}`, name: 'Restricted price office', type: 'BRANCH',
    } });
    const item = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({
      type: 'PRODUCT', name: `Scoped price item ${randomUUID()}`, unit: 'kg', referencePrice: '1', currency: 'USD',
    }).expect(201));
    const offer = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `scoped-price-offer-${randomUUID()}`).send({
      productCode: 'MONARQUE_CONNECT', itemId: item.id, sellUnitCode: 'KG', establishmentId: restrictedEstablishment.id,
    }).expect(201));
    const registration = bodyOf<{ email: string }>(await request(server).post('/api/v1/auth/register').send({
      email: `price-scope-${randomUUID()}@example.com`, password: 'correct horse battery staple', firstName: 'Scoped', lastName: 'Owner',
    }).expect(201));
    const login = bodyOf<{ accessToken: string }>(await request(server).post('/api/v1/auth/login').send({ identifier: registration.email, password: 'correct horse battery staple' }).expect(200));
    const user = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: registration.email.toLowerCase() } });
    const membershipId = randomUUID();
    await prisma.membership.create({ data: {
      id: membershipId, organizationId, userId: user.id, role: 'OWNER', scopeMode: 'SELECTED_ESTABLISHMENTS',
      scopeLinks: { create: [{ establishmentId: primary.id }] },
    } });

    await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers/${offer.id}/price-versions`)
      .set('Authorization', `Bearer ${login.accessToken}`).set('Idempotency-Key', `out-of-scope-price-${randomUUID()}`)
      .send({ amount: '20', currencyCode: 'USD', priceUnitCode: 'KG' }).expect(403);
    await expect(prisma.commercialPriceVersion.count({ where: { offerId: offer.id } })).resolves.toBe(0);
  });

  it('serializes concurrent price publications without duplicate versions', async () => {
    const server = serverOf(app);
    const item = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({
      type: 'PRODUCT', name: `Concurrent price item ${randomUUID()}`, unit: 'kg', referencePrice: '1', currency: 'USD',
    }).expect(201));
    const offer = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/catalog/offers`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `concurrent-price-offer-${randomUUID()}`).send({
      productCode: 'MONARQUE_CONNECT', itemId: item.id, sellUnitCode: 'KG',
    }).expect(201));
    const path = `/api/v1/organizations/${organizationId}/catalog/offers/${offer.id}/price-versions`;
    const responses = await Promise.all(['20', '21'].map((amount) => request(server).post(path)
      .set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `concurrent-price-${amount}-${randomUUID()}`)
      .send({ amount, currencyCode: 'USD', priceUnitCode: 'KG' })));

    expect(responses.every((response) => response.status === 201 || response.status === 409)).toBe(true);
    const versions = await prisma.commercialPriceVersion.findMany({ where: { organizationId, offerId: offer.id, currencyCode: 'USD' }, orderBy: { version: 'asc' }, select: { version: true } });
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions.length).toBeLessThanOrEqual(2);
    expect(versions.map(({ version }) => version)).toEqual(versions.map((_, index) => index + 1));
  });
});

function bodyOf<T>(response: Response): T {
  return response.body as T;
}

function serverOf(application: INestApplication): Parameters<typeof request>[0] {
  const server: unknown = application.getHttpServer();
  return server as Parameters<typeof request>[0];
}
