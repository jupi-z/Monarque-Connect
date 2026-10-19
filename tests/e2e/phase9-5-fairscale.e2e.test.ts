import { generateKeyPair, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('Phase 9.5 FairScale HTTP flow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let otherToken = '';
  let organizationId = '';
  let quoteId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55433/monarque_connect_test';
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = connectionString; process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-test'; process.env.JWT_AUDIENCE = 'monarque-connect-api-test'; process.env.JWT_KEY_ID = 'phase95-e2e';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey); process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); app.useGlobalFilters(new ProblemDetailsFilter()); await app.init();
    prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE billing_promotion_redemptions, billing_promotion_eligibilities, billing_quote_lines, billing_quotes, billing_customer_organizations, billing_customers, outbox_events, event_consumer_receipts, refresh_sessions, login_rate_limit_buckets, organization_module_activations, organization_entitlements, organization_quota_usages, quota_reservations, quota_ledgers, memberships, establishments, subscriptions, audit_events, organizations, users RESTART IDENTITY CASCADE`);
    await seedReferenceData(prisma);
    const server = serverOf(app);
    const owner = await registerAndLogin(server, 'phase95-owner@example.test'); ownerToken = owner.token;
    const other = await registerAndLogin(server, 'phase95-other@example.test'); otherToken = other.token;
    organizationId = bodyOf<{ id: string }>(await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'FairScale tenant', handle: `fairscale-${randomUUID().slice(0, 8)}`, defaultCurrency: 'EUR', establishmentName: 'Head office' }).expect(201)).id;
  });

  afterAll(async () => { if (app) await app.close(); });

  it('publishes the catalog, creates deterministic welcome quotes and isolates tenants', async () => {
    const server = serverOf(app);
    const catalog = bodyOf<{ plans: unknown[]; addons: unknown[]; currency: string }>(await request(server).get('/api/v1/billing/catalog').expect(200));
    expect(catalog).toMatchObject({ currency: 'USD' });
    expect(catalog.plans).toHaveLength(8);
    expect(catalog.addons).toHaveLength(6);

    const first = bodyOf<{ id: string; totalAmountMinor: number; promotionCode: string; addonEstablishments: number }>(await request(server).post(`/api/v1/organizations/${organizationId}/billing/quotes`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase95-business-monthly-5').send({ planCode: 'BUSINESS', billingPeriod: 'MONTHLY', activeEstablishmentCount: 5 }).expect(201));
    quoteId = first.id;
    expect(first).toMatchObject({ totalAmountMinor: 5825, promotionCode: 'WELCOME_MONTHLY15', addonEstablishments: 2 });
    const replay = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/billing/quotes`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase95-business-monthly-5').send({ planCode: 'BUSINESS', billingPeriod: 'MONTHLY', activeEstablishmentCount: 5 }).expect(201));
    expect(replay.id).toBe(quoteId);
    await request(server).post(`/api/v1/organizations/${organizationId}/billing/quotes`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase95-business-monthly-5').send({ planCode: 'BUSINESS', billingPeriod: 'MONTHLY', activeEstablishmentCount: 4 }).expect(409);
    await request(server).get(`/api/v1/organizations/${organizationId}/billing/quotes/${quoteId}`).set('Authorization', `Bearer ${otherToken}`).expect(403);

    const capacity = bodyOf<{ planCode: string; includedEstablishments: number; activeEstablishments: number }>(await request(server).get(`/api/v1/organizations/${organizationId}/billing/capacity`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(capacity).toMatchObject({ planCode: 'CONNECT', includedEstablishments: 1, activeEstablishments: 1 });
    const estimate = bodyOf<{ effectiveEstablishments: number; overCapacity: boolean }>(await request(server).post(`/api/v1/organizations/${organizationId}/billing/capacity/estimate`).set('Authorization', `Bearer ${ownerToken}`).send({ activeEstablishmentCount: 2, addonEstablishmentCount: 1 }).expect(200));
    expect(estimate).toMatchObject({ effectiveEstablishments: 2, overCapacity: false });
  });
});

async function registerAndLogin(server: Parameters<typeof request>[0], email: string): Promise<{ token: string }> {
  const password = 'correct horse battery staple';
  const registration = bodyOf<{ email: string }>(await request(server).post('/api/v1/auth/register').send({ email, password, firstName: 'FairScale', lastName: 'Test' }).expect(201));
  const login = bodyOf<{ accessToken: string }>(await request(server).post('/api/v1/auth/login').send({ identifier: registration.email, password }).expect(200));
  return { token: login.accessToken };
}

function bodyOf<T>(response: Response): T { return response.body as T; }
function serverOf(application: INestApplication): Parameters<typeof request>[0] { return application.getHttpServer() as Parameters<typeof request>[0]; }
