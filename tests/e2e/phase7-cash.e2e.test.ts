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

const password = 'correct horse battery staple';
const generateKeyPairAsync = promisify(generateKeyPair);

describe('Phase 7 Cash HTTP E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token = '';
  let otherToken = '';
  let organizationId = '';
  let otherOrganizationId = '';
  let establishmentId = '';
  let cashAccountId = '';
  let destinationAccountId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_phase7_cash_e2e';
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-phase7-cash-e2e';
    process.env.JWT_AUDIENCE = 'monarque-connect-phase7-cash-api';
    process.env.JWT_KEY_ID = 'phase7-cash-e2e';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    appRef = app;
    prisma = app.get(PrismaService);
    await seedReferenceData(prisma);

    const suffix = Date.now();
    token = await registerAndLogin(`phase7-cash-e2e-${suffix}@example.com`, 'Cash E2E');
    const organization = await createOrganization(token, `phase7-cash-e2e-${suffix}`);
    organizationId = organization.id;
    establishmentId = organization.establishmentId;
    await upgradeToBusiness(organizationId);

    otherToken = await registerAndLogin(`phase7-cash-other-${suffix}@example.com`, 'Other Cash');
    const other = await createOrganization(otherToken, `phase7-cash-other-${suffix}`);
    otherOrganizationId = other.id;
    await upgradeToBusiness(otherOrganizationId);

    const mainAccountResponse = await request(server()).post(`/api/v1/organizations/${organizationId}/cash-accounts`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-cash-account-main').send({ establishmentId, code: 'MAIN-CASH', name: 'Main cash', currency: 'EUR' });
    expect(mainAccountResponse.status, JSON.stringify(mainAccountResponse.body)).toBe(201);
    cashAccountId = bodyOf<{ id: string }>(mainAccountResponse).id;
    const bankAccountResponse = await request(server()).post(`/api/v1/organizations/${organizationId}/cash-accounts`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-cash-account-bank').send({ establishmentId, code: 'BANK', name: 'Bank', currency: 'EUR' });
    expect(bankAccountResponse.status, JSON.stringify(bankAccountResponse.body)).toBe(201);
    destinationAccountId = bodyOf<{ id: string }>(bankAccountResponse).id;
  }, 60000);

  afterAll(async () => {
    if (!app) return;
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId].filter(Boolean) } } });
    await app.close();
  });

  it('executes idempotent deposit, derived balance and linked transfer over HTTP', async () => {
    const input = { establishmentId, cashAccountId, direction: 'IN', amount: '100.0000', occurredAt: '2026-10-14T12:00:00.000Z', reason: 'Opening balance' };
    const first = bodyOf<{ id: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/cash-movements`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-cash-opening').send(input).expect(201));
    const replay = bodyOf<{ id: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/cash-movements`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-cash-opening').send(input).expect(201));
    expect(replay.id).toBe(first.id);

    const account = bodyOf<{ balance: string }>(await request(server()).get(`/api/v1/organizations/${organizationId}/cash-accounts/${cashAccountId}`).set('Authorization', `Bearer ${token}`).expect(200));
    expect(account.balance).toBe('100.0000');

    const transfer = bodyOf<{ id: string; movements: unknown[] }>(await request(server()).post(`/api/v1/organizations/${organizationId}/cash-transfers`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-cash-transfer').send({ establishmentId, sourceCashAccountId: cashAccountId, destinationCashAccountId: destinationAccountId, amount: '25.0000', occurredAt: '2026-10-14T12:01:00.000Z', reason: 'Bank deposit' }).expect(201));
    expect(transfer.movements).toHaveLength(2);
    const source = bodyOf<{ balance: string }>(await request(server()).get(`/api/v1/organizations/${organizationId}/cash-accounts/${cashAccountId}`).set('Authorization', `Bearer ${token}`).expect(200));
    const destination = bodyOf<{ balance: string }>(await request(server()).get(`/api/v1/organizations/${organizationId}/cash-accounts/${destinationAccountId}`).set('Authorization', `Bearer ${token}`).expect(200));
    expect(source.balance).toBe('75.0000');
    expect(destination.balance).toBe('25.0000');
  });

  it('blocks cross-tenant reads over HTTP', async () => {
    await request(server()).get(`/api/v1/organizations/${organizationId}/cash-accounts`).set('Authorization', `Bearer ${otherToken}`).expect(403);
  });

  async function registerAndLogin(email: string, name: string): Promise<string> {
    const [firstName, lastName] = name.split(' ');
    const registration = await request(server()).post('/api/v1/auth/register').send({ email, password, firstName, lastName }).expect(201);
    const login = await request(server()).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(registration).email, password }).expect(200);
    return bodyOf<{ accessToken: string }>(login).accessToken;
  }

  async function createOrganization(authToken: string, handle: string): Promise<{ id: string; establishmentId: string }> {
    const response = await request(server()).post('/api/v1/organizations').set('Authorization', `Bearer ${authToken}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Cash E2E organization', handle, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
    const body = bodyOf<{ id: string; establishment: { id: string } }>(response);
    return { id: body.id, establishmentId: body.establishment.id };
  }

  async function upgradeToBusiness(id: string): Promise<void> {
    const business = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } }, select: { id: true } });
    await prisma.subscription.updateMany({ where: { organizationId: id }, data: { planVersionId: business.id } });
  }
});

function bodyOf<T>(response: Response): T { return response.body as T; }
let appRef!: INestApplication;
function server(): Parameters<typeof request>[0] { return appRef.getHttpServer() as Parameters<typeof request>[0]; }
