import { generateKeyPair, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportPKCS8, exportSPKI } from 'jose';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ProblemDetailsFilter } from '../../src/http/problem-details.filter.js';
import { seedReferenceData } from '../../prisma/seed.js';

const generateKeyPairAsync = promisify(generateKeyPair);

describe('C3 platform FX rate HTTP boundary', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let platformToken = '';
  let platformUserId = '';
  let platformAdminWithoutFxToken = '';
  let nonPlatformToken = '';
  const sourceReference = `c3-fx-${randomUUID()}`;
  const payload = {
    baseCurrency: 'USD',
    quoteCurrency: 'CDF',
    rate: '2360',
    sourceCode: 'TEST_FIXTURE',
    observedAt: '2026-10-28T08:00:00.000Z',
    validFrom: '2026-10-28T08:00:00.000Z',
    validUntil: '2026-10-29T08:00:00.000Z',
    sourceReference,
  };

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_c3_fx_e2e';
    process.env.JWT_ISSUER = 'monarque-connect-c3-fx-e2e';
    process.env.JWT_AUDIENCE = 'monarque-connect-c3-fx-api';
    process.env.JWT_KEY_ID = 'c3-fx-e2e';
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

    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const platform = await registerAndLogin(server, `c3-fx-platform-${randomUUID()}@example.test`);
    platformToken = platform.token;
    platformUserId = (await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: platform.email }, select: { id: true } })).id;
    const platformAdminWithoutFx = await registerAndLogin(server, `c3-fx-platform-limited-${randomUUID()}@example.test`);
    platformAdminWithoutFxToken = platformAdminWithoutFx.token;
    const platformAdminWithoutFxId = (await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: platformAdminWithoutFx.email }, select: { id: true } })).id;
    const nonPlatform = await registerAndLogin(server, `c3-fx-tenant-${randomUUID()}@example.test`);
    nonPlatformToken = nonPlatform.token;
    const config = app.get(ConfigService);
    config.set('PLATFORM_ADMIN_USER_IDS', [platformUserId, platformAdminWithoutFxId]);
    config.set('PLATFORM_PRICING_FX_INGEST_USER_IDS', [platformUserId]);
    config.set('PRICING_FX_ALLOWED_SOURCES', ['TEST_FIXTURE']);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('exposes the FX ingestion route behind the authentication guard', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await request(server)
      .post('/api/v1/platform/pricing/fx-rates')
      .set('Idempotency-Key', 'c3-fx-unauthenticated-test-key')
      .send({})
      .expect(401);
  });

  it('requires both platform-admin and FX-ingestion capability allowlists', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await request(server).post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformAdminWithoutFxToken}`).set('Idempotency-Key', 'c3-fx-no-capability-0001').send(payload).expect(403);
    await request(server).post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${nonPlatformToken}`).set('Idempotency-Key', 'c3-fx-not-platform-0001').send(payload).expect(403);
    await request(server).post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformToken}`).set('Idempotency-Key', 'c3-fx-not-allowlisted-1').send({ ...payload, sourceCode: 'UNAPPROVED' }).expect(403);
    await expect(prisma.fxRate.count({ where: { sourceReference: payload.sourceReference } })).resolves.toBe(0);
  });

  it('records an approved rate once, replays it idempotently and rejects divergent commands', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const key = 'c3-fx-approved-rate-0001';
    const first = bodyOf<{ id: string; rate: string; baseCurrency: string; quoteCurrency: string; sourceReference: string }>(await request(server)
      .post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformToken}`).set('Idempotency-Key', key).send(payload).expect(201));
    const replay = bodyOf<{ id: string }>(await request(server)
      .post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformToken}`).set('Idempotency-Key', key).send(payload).expect(201));
    expectRate(first, payload.sourceReference);
    expect(replay.id).toBe(first.id);

    const sameSourceReplay = bodyOf<{ id: string }>(await request(server)
      .post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformToken}`).set('Idempotency-Key', 'c3-fx-new-key-same-source').send(payload).expect(201));
    expect(sameSourceReplay.id).toBe(first.id);
    await request(server).post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformToken}`).set('Idempotency-Key', key).send({ ...payload, rate: '2361' }).expect(409);
    await request(server).post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformToken}`).set('Idempotency-Key', 'c3-fx-other-key-conflict').send({ ...payload, rate: '2361' }).expect(409);
    await request(server).post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformToken}`).set('Idempotency-Key', 'c3-fx-invalid-decimal-0001').send({ ...payload, sourceReference: `invalid-${randomUUID()}`, rate: '0' }).expect(400);
    await request(server).post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformToken}`).set('Idempotency-Key', 'c3-fx-invalid-pair-0001').send({ ...payload, sourceReference: `invalid-${randomUUID()}`, baseCurrency: 'ZZZ' }).expect(400);
    await request(server).post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformToken}`).set('Idempotency-Key', 'c3-fx-same-currency-0001').send({ ...payload, sourceReference: `invalid-${randomUUID()}`, quoteCurrency: 'USD' }).expect(400);
    await request(server).post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformToken}`).set('Idempotency-Key', 'c3-fx-invalid-window-0001').send({ ...payload, sourceReference: `invalid-${randomUUID()}`, validUntil: payload.validFrom }).expect(400);
    await request(server).post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformToken}`).set('Idempotency-Key', 'short').send(payload).expect(400);

    await expect(prisma.fxRate.count({ where: { sourceCode: payload.sourceCode, sourceReference: payload.sourceReference } })).resolves.toBe(1);
    await expect(prisma.fxRateIngestionReceipt.count({ where: { actorUserId: platformUserId, fxRateId: first.id } })).resolves.toBe(2);
    await expect(prisma.auditEvent.count({ where: { actorUserId: platformUserId, targetType: 'FxRate', targetId: first.id } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { aggregateType: 'FxRate', aggregateId: first.id, eventType: 'pricing.fx_rate.ingested' } })).resolves.toBe(1);
    await expect(prisma.fxRate.update({ where: { id: first.id }, data: { rate: '1' } })).rejects.toThrow();
    await expect(prisma.fxRate.delete({ where: { id: first.id } })).rejects.toThrow();
  });

  it('converges concurrent identical idempotent submissions to one rate and one event', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const concurrentPayload = { ...payload, sourceReference: `concurrent-${randomUUID()}` };
    const key = `c3-fx-concurrent-${randomUUID()}`;
    const submit = () => request(server).post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformToken}`).set('Idempotency-Key', key).send(concurrentPayload);
    const [left, right] = await Promise.all([submit(), submit()]);
    expect(left.status).toBe(201);
    expect(right.status).toBe(201);
    expect((left.body as { id: string }).id).toBe((right.body as { id: string }).id);
    const fxRateId = (left.body as { id: string }).id;
    await expect(prisma.fxRate.count({ where: { id: fxRateId } })).resolves.toBe(1);
    await expect(prisma.fxRateIngestionReceipt.count({ where: { actorUserId: platformUserId, idempotencyKey: key } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { aggregateType: 'FxRate', aggregateId: fxRateId, eventType: 'pricing.fx_rate.ingested' } })).resolves.toBe(1);
  });

  it('deduplicates concurrent source references submitted with different idempotency keys', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const concurrentPayload = { ...payload, sourceReference: `same-source-${randomUUID()}` };
    const submit = (key: string) => request(server).post('/api/v1/platform/pricing/fx-rates').set('Authorization', `Bearer ${platformToken}`).set('Idempotency-Key', key).send(concurrentPayload);
    const [left, right] = await Promise.all([submit('c3-fx-source-race-key-0001'), submit('c3-fx-source-race-key-0002')]);
    expect(left.status).toBe(201);
    expect(right.status).toBe(201);
    const fxRateId = (left.body as { id: string }).id;
    expect((right.body as { id: string }).id).toBe(fxRateId);
    await expect(prisma.fxRate.count({ where: { sourceCode: payload.sourceCode, sourceReference: concurrentPayload.sourceReference } })).resolves.toBe(1);
    await expect(prisma.fxRateIngestionReceipt.count({ where: { actorUserId: platformUserId, fxRateId } })).resolves.toBe(2);
    await expect(prisma.auditEvent.count({ where: { actorUserId: platformUserId, targetType: 'FxRate', targetId: fxRateId } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { aggregateType: 'FxRate', aggregateId: fxRateId, eventType: 'pricing.fx_rate.ingested' } })).resolves.toBe(1);
  });
});

async function registerAndLogin(server: Parameters<typeof request>[0], email: string): Promise<{ token: string; email: string }> {
  const password = 'correct horse battery staple';
  const registration = bodyOf<{ email: string }>(await request(server).post('/api/v1/auth/register').send({ email, password, firstName: 'C3', lastName: 'FX' }).expect(201));
  const login = bodyOf<{ accessToken: string }>(await request(server).post('/api/v1/auth/login').send({ identifier: registration.email, password }).expect(200));
  return { token: login.accessToken, email: registration.email };
}

function expectRate(value: { rate: string; baseCurrency: string; quoteCurrency: string; sourceReference: string }, expectedSourceReference: string): void {
  if (value.rate !== '2360.000000000000000000' || value.baseCurrency !== 'USD' || value.quoteCurrency !== 'CDF' || value.sourceReference !== expectedSourceReference) {
    throw new Error('FX rate response did not preserve its canonical decimal and provenance');
  }
}

function bodyOf<T>(response: Response): T { return response.body as T; }
