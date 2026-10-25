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
    await prisma.organizationModuleActivation.upsert({ where: { organizationId_moduleCode: { organizationId, moduleCode: 'CATALOG' } }, update: { enabled: false }, create: { id: crypto.randomUUID(), organizationId, moduleCode: 'CATALOG', enabled: false } });
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', name: 'Blocked', unit: 'piece', referencePrice: '1', currency: 'EUR' }).expect(403);
    await prisma.organizationModuleActivation.update({ where: { organizationId_moduleCode: { organizationId, moduleCode: 'CATALOG' } }, data: { enabled: true } });
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
});

function bodyOf<T>(response: Response): T {
  return response.body as T;
}

function serverOf(application: INestApplication): Parameters<typeof request>[0] {
  const server: unknown = application.getHttpServer();
  return server as Parameters<typeof request>[0];
}
