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
import { expectHttpStatusWithDiagnostics } from '../setup/http-diagnostics.js';
import { authorizationSnapshot } from '../setup/authorization-snapshot.js';

const generateKeyPairAsync = promisify(generateKeyPair);

describe('Warehouses referential', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let scopedToken = '';
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
    process.env.JWT_KEY_ID = 'phase3-warehouses-test';
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

    const registration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: 'phase3-warehouse-owner@example.com', password: 'correct horse battery staple', firstName: 'Phase', lastName: 'Owner' }).expect(201);
    const login = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(registration).email, password: 'correct horse battery staple' }).expect(200);
    ownerToken = bodyOf<{ accessToken: string }>(login).accessToken;
    const organizationHandle = `phase3-warehouses-${Date.now()}`;
    const organizationResponse = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Phase 3 Inventory Tenant', handle: organizationHandle, defaultCurrency: 'EUR', establishmentName: 'Main office' });
    await expectHttpStatusWithDiagnostics(
      organizationResponse,
      201,
      'Warehouses referential',
      'create setup organization',
      async () => ({
        organizationWithHandle: await prisma.organization.findUnique({ where: { handle: organizationHandle }, select: { id: true, status: true } }),
        connectPlan: await prisma.planVersion.findUnique({
          where: { planCode_version: { planCode: 'CONNECT', version: 1 } },
          select: { id: true, status: true, quotas: { select: { quotaCode: true, mode: true, limitValue: true } } },
        }),
      }),
    );
    const organization = organizationResponse;
    const createdOrganization = bodyOf<{ id: string; establishment: { id: string } }>(organization);
    organizationId = createdOrganization.id;
    primaryEstablishmentId = createdOrganization.establishment.id;
    const businessVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } } });
    await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: businessVersion.id, startsAt: new Date('2020-01-01T00:00:00.000Z') } });
    const secondary = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'SECOND', name: 'Secondary office', type: 'BRANCH' }).expect(201);
    secondaryEstablishmentId = bodyOf<{ id: string }>(secondary).id;

    const scopedRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: 'phase3-warehouse-scoped@example.com', password: 'correct horse battery staple', firstName: 'Scoped', lastName: 'Operator' }).expect(201);
    const scopedLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(scopedRegistration).email, password: 'correct horse battery staple' }).expect(200);
    scopedToken = bodyOf<{ accessToken: string }>(scopedLogin).accessToken;
    const scopedUser = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: 'phase3-warehouse-scoped@example.com' } });
    const membershipId = crypto.randomUUID();
    await prisma.membership.create({ data: { id: membershipId, organizationId, userId: scopedUser.id, role: 'OPERATIONS', scopeMode: 'SELECTED_ESTABLISHMENTS' } });
    await prisma.membershipEstablishmentScope.create({ data: { membershipId, organizationId, establishmentId: primaryEstablishmentId } });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('creates and lists a warehouse under the same tenant establishment with atomic events', async () => {
    const created = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'MAIN', name: 'Main warehouse' }).expect(201);
    const warehouse = bodyOf<{ id: string; organizationId: string; establishmentId: string; code: string; active: boolean }>(created);
    expect(warehouse).toMatchObject({ organizationId, establishmentId: primaryEstablishmentId, code: 'MAIN', active: true });
    const listed = await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses?active=true`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ items: Array<{ id: string }> }>(listed).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: warehouse.id })]));
    await expect(prisma.auditEvent.findFirst({ where: { targetType: 'Warehouse', targetId: warehouse.id, action: 'WAREHOUSE_CREATED', establishmentId: primaryEstablishmentId } })).resolves.not.toBeNull();
    await expect(prisma.outboxEvent.findFirst({ where: { aggregateType: 'Warehouse', aggregateId: warehouse.id, eventType: 'warehouse.created', establishmentId: primaryEstablishmentId } })).resolves.not.toBeNull();
  });

  it('enforces selected establishment scope and organization-wide code uniqueness', async () => {
    const primaryWarehouse = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'SCOPE-MAIN', name: 'Scope test warehouse' }).expect(201);
    const primaryWarehouseId = bodyOf<{ id: string }>(primaryWarehouse).id;
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses/${primaryWarehouseId}`).set('Authorization', `Bearer ${scopedToken}`).expect(200);
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/establishments/${secondaryEstablishmentId}/warehouses`).set('Authorization', `Bearer ${scopedToken}`).expect(403);
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/establishments/${secondaryEstablishmentId}/warehouses/${primaryWarehouseId}`).set('Authorization', `Bearer ${scopedToken}`).expect(403);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${secondaryEstablishmentId}/warehouses`).set('Authorization', `Bearer ${scopedToken}`).send({ code: 'SECOND', name: 'Blocked warehouse' }).expect(403);
    const allowed = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses`).set('Authorization', `Bearer ${scopedToken}`).send({ code: 'SCOPED', name: 'Scoped warehouse' }).expect(201);
    expect(bodyOf<{ establishmentId: string }>(allowed).establishmentId).toBe(primaryEstablishmentId);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${secondaryEstablishmentId}/warehouses`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'SCOPE-MAIN', name: 'Duplicate code' }).expect(409);
  });

  it('lets PostgreSQL decide one winner for concurrent duplicate warehouse codes', async () => {
    const responses = await Promise.all([
      request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'RACE', name: 'Race one' }),
      request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'RACE', name: 'Race two' }),
    ]);
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
  });

  it('supports idempotent deactivation and refuses disabled INVENTORY', async () => {
    const created = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'TEMP', name: 'Temporary warehouse' }).expect(201);
    const warehouseId = bodyOf<{ id: string }>(created).id;
    const deactivated = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses/${warehouseId}/deactivate`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ active: boolean }>(deactivated).active).toBe(false);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses/${warehouseId}/deactivate`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    await expect(prisma.auditEvent.count({ where: { targetType: 'Warehouse', targetId: warehouseId, action: 'WAREHOUSE_STATUS_CHANGED' } })).resolves.toBe(1);
    await prisma.organizationModuleActivation.upsert({ where: { organizationId_productCode_moduleCode: { productCode: 'MONARQUE_CONNECT', organizationId, moduleCode: 'INVENTORY' } }, update: { enabled: false }, create: { id: crypto.randomUUID(), organizationId, moduleCode: 'INVENTORY', enabled: false } });
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'BLOCKED', name: 'Blocked warehouse' }).expect(403);
    await prisma.organizationModuleActivation.update({ where: { organizationId_productCode_moduleCode: { productCode: 'MONARQUE_CONNECT', organizationId, moduleCode: 'INVENTORY' } }, data: { enabled: true } });
  });

  it('excludes inactive warehouses by default while allowing an explicit inactive filter', async () => {
    const created = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'INACTIVE', name: 'Inactive warehouse' }).expect(201);
    const warehouseId = bodyOf<{ id: string }>(created).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses/${warehouseId}/deactivate`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const defaultList = await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const inactiveList = await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses?active=false`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ items: Array<{ id: string }> }>(defaultList).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: warehouseId })]));
    expect(bodyOf<{ items: Array<{ id: string }> }>(inactiveList).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: warehouseId })]));
  });

  it('emits one status event for concurrent warehouse deactivation requests', async () => {
    const created = await expectHttpStatusWithDiagnostics(
      await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'CONCURRENT', name: 'Concurrent warehouse' }),
      201,
      'Warehouses integration',
      'create warehouse before concurrent deactivation',
      () => authorizationSnapshot(prisma, organizationId),
    );
    const warehouseId = bodyOf<{ id: string }>(created).id;
    const responses = await Promise.all([
      request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses/${warehouseId}/deactivate`).set('Authorization', `Bearer ${ownerToken}`),
      request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments/${primaryEstablishmentId}/warehouses/${warehouseId}/deactivate`).set('Authorization', `Bearer ${ownerToken}`),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    await expect(prisma.auditEvent.count({ where: { targetType: 'Warehouse', targetId: warehouseId, action: 'WAREHOUSE_STATUS_CHANGED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { aggregateType: 'Warehouse', aggregateId: warehouseId, eventType: 'warehouse.status_changed' } })).resolves.toBe(1);
  });
});

function bodyOf<T>(response: Response): T {
  return response.body as T;
}

function serverOf(application: INestApplication): Parameters<typeof request>[0] {
  const server: unknown = application.getHttpServer();
  return server as Parameters<typeof request>[0];
}
