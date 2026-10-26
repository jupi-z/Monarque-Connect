import { beforeAll, afterAll, describe, expect, it } from 'vitest';
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

describe('Identity, tenancy and Phase 2 HTTP flows', () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
  let app: INestApplication;
  let ownerToken = '';
  let organizationId = '';
  let prisma: PrismaService;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = connectionString;
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-test';
    process.env.JWT_AUDIENCE = 'monarque-connect-api-test';
    process.env.JWT_KEY_ID = 'e2e-key-1';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.businessType.upsert({ where: { code: 'COMMERCE_DISTRIBUTION' }, update: { active: true }, create: { code: 'COMMERCE_DISTRIBUTION', name: 'Commerce & distribution', sortOrder: 10 } });
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
  });

  afterAll(async () => { if (app) await app.close(); });

  it('supports register → login → me → organization → establishment → capabilities and blocks cross-tenant access', async () => {
    const server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
    const registration = await request(server).post('/api/v1/auth/register').send({ email: 'http-owner@example.com', password: 'correct horse battery staple', firstName: 'HTTP', lastName: 'Owner' }).expect(201);
    const registrationBody = bodyOf<{ email: string; id: string }>(registration);
    expect(registrationBody.email).toBe('http-owner@example.com');
    const login = await request(server).post('/api/v1/auth/login').send({ identifier: 'http-owner@example.com', password: 'correct horse battery staple' }).expect(200);
    ownerToken = bodyOf<{ accessToken: string }>(login).accessToken;
    const me = await request(server).get('/api/v1/auth/me').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ email: string }>(me).email).toBe('http-owner@example.com');
    await request(server).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Enterprise attempt', handle: 'enterprise-attempt', defaultCurrency: 'EUR', establishmentName: 'Main office', planCode: 'ENTERPRISE' }).expect(400);
    const organizationResponse = await request(server).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'HTTP Tenant', handle: 'http-tenant', defaultCurrency: 'EUR', establishmentName: 'Main office' });
    const organization = await expectHttpStatusWithDiagnostics(organizationResponse, 201, 'Phase 1 HTTP E2E', 'create organization', async () => {
      const [existing, owner, connectPlan] = await Promise.all([
        prisma.organization.findMany({ where: { handle: 'http-tenant' }, select: { status: true, businessTypeCode: true } }),
        prisma.user.findUnique({ where: { normalizedEmail: 'http-owner@example.com' }, select: { status: true, memberships: { select: { status: true, role: true } } } }),
        prisma.planVersion.findUnique({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } }, select: { status: true, planCode: true, version: true, modules: { select: { moduleCode: true, defaultEnabled: true } }, quotas: { select: { quotaCode: true, mode: true, limitValue: true } } } }),
      ]);
      return { existingOrganizationsWithHandle: existing, ownerAccount: owner, connectPlan };
    });
    const organizationBody = bodyOf<{ id: string; establishment: { isPrimary: boolean } }>(organization);
    organizationId = organizationBody.id;
    expect(organizationBody.establishment.isPrimary).toBe(true);
    const organizations = await request(server).get('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<unknown[]>(organizations)).toHaveLength(1);
    const establishments = await request(server).get(`/api/v1/organizations/${organizationId}/establishments`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<unknown[]>(establishments)).toHaveLength(1);
    const establishment = bodyOf<Array<{ id: string }>>(establishments)[0]!;
    const detail = await request(server).get(`/api/v1/organizations/${organizationId}/establishments/${establishment.id}`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ id: string }>(detail).id).toBe(establishment.id);
    const updated = await request(server).patch(`/api/v1/organizations/${organizationId}/establishments/${establishment.id}`).set('Authorization', `Bearer ${ownerToken}`).send({ name: 'Renamed main office' }).expect(200);
    expect(bodyOf<{ name: string }>(updated).name).toBe('Renamed main office');
    const capabilities = await request(server).get(`/api/v1/organizations/${organizationId}/capabilities?establishmentId=${establishment.id}`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<{ role: string; activeEstablishmentId: string; establishments: unknown[] }>(capabilities)).toMatchObject({ role: 'OWNER', activeEstablishmentId: establishment.id });
    expect(bodyOf<{ role: string; establishments: unknown[] }>(capabilities).establishments).toHaveLength(1);
    const modules = await request(server).get(`/api/v1/organizations/${organizationId}/modules`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<Array<{ code: string; entitled: boolean; active: boolean }>>(modules).find((module) => module.code === 'CATALOG')).toMatchObject({ entitled: true, active: true });
    await request(server).patch(`/api/v1/organizations/${organizationId}/modules/CATALOG`).set('Authorization', `Bearer ${ownerToken}`).send({ enabled: false, reason: 'HTTP E2E deactivation proof' }).expect(200);
    const deactivatedCapabilities = await request(server).get(`/api/v1/organizations/${organizationId}/capabilities`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const catalogDecision = bodyOf<{ modules: Array<{ code: string; allowed: boolean; reason: string }> }>(deactivatedCapabilities).modules.find((module) => module.code === 'CATALOG');
    if (catalogDecision?.reason !== 'MODULE_DEACTIVATED') {
      console.error(`[phase1-entitlement-test-diagnostic] ${JSON.stringify({ decision: catalogDecision, sqlSnapshot: await authorizationSnapshot(prisma, organizationId) })}`);
    }
    expect(catalogDecision).toMatchObject({ allowed: false, reason: 'MODULE_DEACTIVATED' });
    const reactivationResponse = await request(server).patch(`/api/v1/organizations/${organizationId}/modules/CATALOG`).set('Authorization', `Bearer ${ownerToken}`).send({ enabled: true, reason: 'HTTP E2E reactivation proof' });
    await expectHttpStatusWithDiagnostics(reactivationResponse, 200, 'Phase 1 HTTP E2E', 'reactivate CATALOG', () => authorizationSnapshot(prisma, organizationId));
    const quotas = await request(server).get(`/api/v1/organizations/${organizationId}/quotas`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(bodyOf<Array<{ quotaCode: string; mode: string; limit: string; used: string; reserved: string }>>(quotas)).toEqual(expect.arrayContaining([expect.objectContaining({ quotaCode: 'MAX_USERS', mode: 'CAPACITY', limit: '5', used: '1', reserved: '0' })]));
    const otherRegistration = await request(server).post('/api/v1/auth/register').send({ email: 'http-other@example.com', password: 'correct horse battery staple', firstName: 'HTTP', lastName: 'Other' }).expect(201);
    const otherRegistrationBody = bodyOf<{ email: string }>(otherRegistration);
    const otherLogin = await request(server).post('/api/v1/auth/login').send({ identifier: otherRegistrationBody.email, password: 'correct horse battery staple' }).expect(200);
    const forbidden = await request(server).get(`/api/v1/organizations/${organizationId}`).set('Authorization', `Bearer ${bodyOf<{ accessToken: string }>(otherLogin).accessToken}`).expect('Content-Type', /application\/problem\+json/).expect(403);
    expect(bodyOf<{ type: string; requestId: string }>(forbidden).type).toContain('/problems/403');
    expect(bodyOf<{ type: string; requestId: string }>(forbidden).requestId).toBeTruthy();
  });

  it('rate-limits repeated failed login attempts without revealing account existence', async () => {
    const server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server).post('/api/v1/auth/login').send({ identifier: 'unknown-rate-limited@example.com', password: 'wrong password' }).expect(401);
    }
    await request(server).post('/api/v1/auth/login').send({ identifier: 'unknown-rate-limited@example.com', password: 'wrong password' }).expect(429);
  });
});

function bodyOf<T>(response: Response): T {
  return response.body as T;
}
