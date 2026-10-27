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

const password = 'correct horse battery staple';
const generateKeyPairAsync = promisify(generateKeyPair);
const day1 = new Date('2026-10-20T00:00:00.000Z');
const day2 = new Date('2026-10-21T00:00:00.000Z');
const periodEnd = new Date('2026-10-22T00:00:00.000Z');
const sourceAsOf = new Date('2026-10-21T12:00:00.000Z');
type MetricResponse = {
  metricCode: string;
  kind: 'ACTIVITY' | 'CURRENT_STATE';
  dimensions: { currency?: string; establishmentId?: string; [key: string]: string | undefined };
  value: { amount?: string; currency?: string };
  period?: { from: string; to: string };
};
type AlertResponse = { id: string; sourceType: string; establishmentId: string | null; resolvedAt: string | null };

describe('Phase 10A Intelligence dashboard and metric HTTP E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let salesToken = '';
  let otherTenantToken = '';
  let organizationId = '';
  let establishmentId = '';
  let otherEstablishmentId = '';
  let salesUserId = '';
  let salesMembershipId = '';
  let connectOrganizationId = '';
  let connectToken = '';
  let invoiceAlertId = '';
  let projectAlertId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_phase10a_e2e';
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-phase10a-e2e';
    process.env.JWT_AUDIENCE = 'monarque-connect-phase10a-api';
    process.env.JWT_KEY_ID = 'phase10a-e2e';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await seedReferenceData(prisma);

    const suffix = randomUUID().slice(0, 8);
    ownerToken = await registerAndLogin(`phase10a-owner-${suffix}@example.com`, 'Intelligence Owner');
    const organization = bodyOf<{ id: string; establishment: { id: string } }>(await request(server())
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Phase 10A Intelligence', handle: `phase10a-${suffix}`, defaultCurrency: 'EUR', establishmentName: 'Main office' })
      .expect(201));
    organizationId = organization.id;
    establishmentId = organization.establishment.id;
    await activateBusinessPlan(organizationId);
    otherEstablishmentId = randomUUID();
    await prisma.establishment.create({ data: { id: otherEstablishmentId, organizationId, code: 'SECOND', name: 'Second office', type: 'OFFICE' } });

    salesToken = await registerAndLogin(`phase10a-sales-${suffix}@example.com`, 'Intelligence Sales');
    const salesUser = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: `phase10a-sales-${suffix}@example.com` }, select: { id: true } });
    salesUserId = salesUser.id;
    salesMembershipId = randomUUID();
    await prisma.membership.create({ data: { id: salesMembershipId, organizationId, userId: salesUserId, role: 'SALES', scopeMode: 'SELECTED_ESTABLISHMENTS', scopeLinks: { create: [{ establishmentId }] } } });

    otherTenantToken = await registerAndLogin(`phase10a-other-${suffix}@example.com`, 'Other Tenant');
    const connect = bodyOf<{ id: string }>(await request(server())
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${otherTenantToken}`)
      .send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Connect only', handle: `connect-${suffix}`, defaultCurrency: 'EUR', establishmentName: 'Main office' })
      .expect(201));
    connectOrganizationId = connect.id;
    connectToken = otherTenantToken;

    await seedSnapshots();
  }, 60000);

  afterAll(async () => {
    if (connectOrganizationId) await prisma.organization.deleteMany({ where: { id: connectOrganizationId } });
    if (organizationId) await prisma.organization.deleteMany({ where: { id: organizationId } });
    if (app) await app.close();
  });

  it('serves exact, currency-separated activity and current-state projections with stable pagination', async () => {
    const dashboard = bodyOf<{ metrics: MetricResponse[]; openAlerts: unknown[]; calculatedAt: string; sourceAsOf: string }>(await request(server())
      .get(`/api/v1/organizations/${organizationId}/intelligence/dashboard?from=${day1.toISOString()}&to=${periodEnd.toISOString()}&establishmentId=${establishmentId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200));

    const sales = dashboard.metrics.filter((metric) => metric.metricCode === 'SALES_ISSUED');
    expect(sales).toHaveLength(2);
    expect(sales.map((metric) => metric.dimensions.currency).sort()).toEqual(['EUR', 'USD']);
    expect(sales.find((metric) => metric.dimensions.currency === 'EUR')?.value.amount).toBe('100.2500');
    expect(sales.find((metric) => metric.dimensions.currency === 'USD')?.value.amount).toBe('40.0000');
    expect(sales.every((metric) => metric.period?.from === day1.toISOString() && metric.period?.to === periodEnd.toISOString())).toBe(true);
    const cash = dashboard.metrics.find((metric) => metric.metricCode === 'CASH_BALANCE');
    expect(cash?.value.amount).toBe('5.0000');
    expect(cash?.dimensions.accountId).toBeTruthy();
    expect(cash?.dimensions.cashAccountId).toBeUndefined();
    expect(dashboard.openAlerts).toHaveLength(1);
    expect(dashboard.openAlerts[0]).not.toHaveProperty('payloadJson');
    expect(dashboard.openAlerts[0]).toHaveProperty('resolvedAt', null);
    expect(Date.parse(dashboard.calculatedAt)).not.toBeNaN();
    expect(Date.parse(dashboard.sourceAsOf)).not.toBeNaN();
    expect(sales[0]).not.toHaveProperty('organizationId');
    expect(sales[0]).not.toHaveProperty('dimensionKey');
    expect(sales[0]).not.toHaveProperty('valueDecimal');
    expect(JSON.stringify(dashboard)).not.toContain('private invoice description');

    const firstPage = bodyOf<{ items: MetricResponse[]; hasMore: boolean; nextCursor: string | null }>(await request(server())
      .get(`/api/v1/organizations/${organizationId}/intelligence/metrics?metricCodes=SALES_ISSUED&from=${day1.toISOString()}&to=${periodEnd.toISOString()}&grain=MONTH&limit=1&establishmentId=${establishmentId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200));
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = bodyOf<{ items: MetricResponse[]; hasMore: boolean; nextCursor: string | null }>(await request(server())
      .get(`/api/v1/organizations/${organizationId}/intelligence/metrics?metricCodes=SALES_ISSUED&from=${day1.toISOString()}&to=${periodEnd.toISOString()}&grain=MONTH&limit=1&establishmentId=${establishmentId}&cursor=${encodeURIComponent(firstPage.nextCursor!)}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200));
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.dimensions.currency).not.toBe(firstPage.items[0]?.dimensions.currency);
    expect(secondPage.hasMore).toBe(false);
    const currentOnly = bodyOf<{ items: MetricResponse[] }>(await request(server())
      .get(`/api/v1/organizations/${organizationId}/intelligence/metrics?metricCodes=CASH_BALANCE&establishmentId=${establishmentId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200));
    expect(currentOnly.items).toHaveLength(1);
    expect(currentOnly.items[0]?.kind).toBe('CURRENT_STATE');
    await request(server())
      .get(`/api/v1/organizations/${organizationId}/intelligence/metrics?metricCodes=SALES_ISSUED&from=${day2.toISOString()}&to=${periodEnd.toISOString()}&grain=MONTH&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
  });

  it('rejects inactive tenants/members, missing entitlement, and source-module access', async () => {
    await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/dashboard?from=${day1.toISOString()}&to=${periodEnd.toISOString()}`).expect(401);
    await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/dashboard?from=${day1.toISOString()}&to=${periodEnd.toISOString()}`).set('Authorization', `Bearer ${otherTenantToken}`).expect(403);
    await request(server()).get(`/api/v1/organizations/${connectOrganizationId}/intelligence/dashboard?from=${day1.toISOString()}&to=${periodEnd.toISOString()}`).set('Authorization', `Bearer ${connectToken}`).expect(403);

    await prisma.membership.update({ where: { id: salesMembershipId }, data: { status: 'SUSPENDED' } });
    await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/metrics?metricCodes=SALES_ISSUED&from=${day1.toISOString()}&to=${periodEnd.toISOString()}`).set('Authorization', `Bearer ${salesToken}`).expect(403);
    await prisma.membership.update({ where: { id: salesMembershipId }, data: { status: 'ACTIVE' } });

    await prisma.organizationModuleActivation.upsert({ where: { organizationId_moduleCode: { organizationId, moduleCode: 'SALES' } }, create: { id: randomUUID(), organizationId, moduleCode: 'SALES', enabled: false }, update: { enabled: false } });
    await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/metrics?metricCodes=SALES_ISSUED&from=${day1.toISOString()}&to=${periodEnd.toISOString()}`).set('Authorization', `Bearer ${ownerToken}`).expect(403);
    const salesDashboard = bodyOf<{ metrics: MetricResponse[] }>(await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/dashboard?from=${day1.toISOString()}&to=${periodEnd.toISOString()}`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(salesDashboard.metrics.some((metric) => metric.metricCode === 'SALES_ISSUED')).toBe(false);
    await prisma.organizationModuleActivation.deleteMany({ where: { organizationId, moduleCode: 'SALES' } });

    await prisma.organization.update({ where: { id: organizationId }, data: { status: 'SUSPENDED' } });
    await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/dashboard?from=${day1.toISOString()}&to=${periodEnd.toISOString()}`).set('Authorization', `Bearer ${ownerToken}`).expect(403);
    await prisma.organization.update({ where: { id: organizationId }, data: { status: 'ACTIVE' } });
  });

  it('enforces source permissions and selected establishment scope without widening', async () => {
    await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/metrics?metricCodes=CASH_BALANCE`).set('Authorization', `Bearer ${salesToken}`).expect(403);
    await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/metrics?metricCodes=SALES_ISSUED&from=${day1.toISOString()}&to=${periodEnd.toISOString()}&establishmentId=${otherEstablishmentId}`).set('Authorization', `Bearer ${salesToken}`).expect(403);
    const scoped = bodyOf<{ items: MetricResponse[] }>(await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/metrics?metricCodes=SALES_ISSUED&from=${day1.toISOString()}&to=${periodEnd.toISOString()}`).set('Authorization', `Bearer ${salesToken}`).expect(200));
    expect(scoped.items.every((item) => item.dimensions.establishmentId === establishmentId)).toBe(true);
    const salesDashboard = bodyOf<{ metrics: MetricResponse[] }>(await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/dashboard?from=${day1.toISOString()}&to=${periodEnd.toISOString()}`).set('Authorization', `Bearer ${salesToken}`).expect(200));
    expect(salesDashboard.metrics.some((metric) => metric.metricCode === 'CASH_BALANCE')).toBe(false);
  });

  it('paginates tenant-scoped alerts and enforces source-module and establishment access on detail', async () => {
    const first = bodyOf<{ items: AlertResponse[]; hasMore: boolean; nextCursor: string | null }>(await request(server())
      .get(`/api/v1/organizations/${organizationId}/intelligence/alerts?limit=1`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200));
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    expect(first.items[0]).not.toHaveProperty('payloadJson');
    expect(JSON.stringify(first)).not.toContain('private invoice description');

    const second = bodyOf<{ items: AlertResponse[]; hasMore: boolean; nextCursor: string | null }>(await request(server())
      .get(`/api/v1/organizations/${organizationId}/intelligence/alerts?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200));
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(second.hasMore).toBe(false);
    expect(JSON.stringify(second)).not.toContain('private project description');

    await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/alerts?status=RESOLVED&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`).set('Authorization', `Bearer ${ownerToken}`).expect(400);
    await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/alerts`).set('Authorization', `Bearer ${otherTenantToken}`).expect(403);
    await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/alerts/${invoiceAlertId}`).set('Authorization', `Bearer ${otherTenantToken}`).expect(403);
    await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/alerts/${invoiceAlertId}`).set('Authorization', `Bearer ${ownerToken}`).expect(200);

    const scoped = bodyOf<{ items: AlertResponse[] }>(await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/alerts`).set('Authorization', `Bearer ${salesToken}`).expect(200));
    expect(scoped.items.every((alert) => alert.establishmentId === establishmentId)).toBe(true);
    await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/alerts/${projectAlertId}`).set('Authorization', `Bearer ${salesToken}`).expect(404);

    await prisma.organizationModuleActivation.upsert({ where: { organizationId_moduleCode: { organizationId, moduleCode: 'PROJECTS' } }, create: { id: randomUUID(), organizationId, moduleCode: 'PROJECTS', enabled: false }, update: { enabled: false } });
    const withProjectsDisabled = bodyOf<{ items: AlertResponse[] }>(await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/alerts`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(withProjectsDisabled.items.some((alert) => alert.id === projectAlertId)).toBe(false);
    await request(server()).get(`/api/v1/organizations/${organizationId}/intelligence/alerts/${projectAlertId}`).set('Authorization', `Bearer ${ownerToken}`).expect(403);
    await prisma.organizationModuleActivation.deleteMany({ where: { organizationId, moduleCode: 'PROJECTS' } });
  });

  async function seedSnapshots(): Promise<void> {
    const rows = [
      ['EUR', 1, '100.0000', establishmentId],
      ['EUR', 2, '0.2500', establishmentId],
      ['USD', 1, '40.0000', establishmentId],
      ['EUR', 2, '900.0000', otherEstablishmentId],
    ] as const;
    for (const [currency, day, amount, scopedEstablishmentId] of rows) {
      const periodStart = day === 1 ? day1 : day2;
      const nextDay = new Date(periodStart.getTime() + 86_400_000);
      await prisma.metricSnapshot.create({ data: {
        id: randomUUID(), organizationId, establishmentId: scopedEstablishmentId, scopeKey: `ESTABLISHMENT:${scopedEstablishmentId}`,
        metricCode: 'SALES_ISSUED', definitionVersion: 1, periodStart, periodEnd: nextDay, asOf: null,
        valueJson: { count: 1, amount, currency }, currency, currencyKey: currency,
        dimensionKey: JSON.stringify({ establishmentId: scopedEstablishmentId, currencyKey: currency }),
        calculatedAt: sourceAsOf, sourceAsOf,
      } });
    }
    await prisma.metricSnapshot.create({ data: {
      id: randomUUID(), organizationId, establishmentId, scopeKey: `ESTABLISHMENT:${establishmentId}`,
      metricCode: 'CASH_BALANCE', definitionVersion: 1, periodStart: null, periodEnd: null, asOf: sourceAsOf,
      valueJson: { amount: '5.0000', currency: 'EUR' }, currency: 'EUR', currencyKey: 'EUR',
      dimensionKey: JSON.stringify({ cashAccountId: randomUUID(), currencyKey: 'EUR', establishmentId }),
      calculatedAt: sourceAsOf, sourceAsOf,
    } });
    const invoiceAlert = await prisma.insightAlert.create({ data: {
      id: randomUUID(), organizationId, establishmentId, ruleCode: 'INVOICE_OVERDUE', ruleVersion: 1,
      severity: 'WARNING', status: 'OPEN', sourceType: 'INVOICE', sourceId: randomUUID(), dedupeKey: `e2e:${randomUUID()}`,
      triggeredAt: sourceAsOf, lastEvaluatedAt: sourceAsOf, payloadJson: { description: 'private invoice description' },
    } });
    invoiceAlertId = invoiceAlert.id;
    const projectAlert = await prisma.insightAlert.create({ data: {
      id: randomUUID(), organizationId, establishmentId: otherEstablishmentId, ruleCode: 'PROJECT_OVERDUE', ruleVersion: 1,
      severity: 'WARNING', status: 'OPEN', sourceType: 'PROJECT', sourceId: randomUUID(), dedupeKey: `e2e:${randomUUID()}`,
      triggeredAt: new Date(sourceAsOf.getTime() - 1000), lastEvaluatedAt: sourceAsOf, payloadJson: { description: 'private project description' },
    } });
    projectAlertId = projectAlert.id;
  }

  async function activateBusinessPlan(tenantId: string): Promise<void> {
    const plan = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } }, select: { id: true } });
    await prisma.subscription.updateMany({ where: { organizationId: tenantId }, data: { planVersionId: plan.id, startsAt: new Date('2020-01-01T00:00:00.000Z') } });
  }

  async function registerAndLogin(email: string, name: string): Promise<string> {
    const [firstName, lastName] = name.split(' ');
    await request(server()).post('/api/v1/auth/register').send({ email, password, firstName, lastName }).expect(201);
    const login = bodyOf<{ accessToken: string }>(await request(server()).post('/api/v1/auth/login').send({ identifier: email, password }).expect(200));
    return login.accessToken;
  }

  function server(): Parameters<typeof request>[0] { return app.getHttpServer() as Parameters<typeof request>[0]; }
});

function bodyOf<T>(response: Response): T { return response.body as T; }
