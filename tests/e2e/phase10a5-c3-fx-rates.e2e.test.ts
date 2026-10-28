import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportPKCS8, exportSPKI } from 'jose';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { ProblemDetailsFilter } from '../../src/http/problem-details.filter.js';

const generateKeyPairAsync = promisify(generateKeyPair);

describe('C3 platform FX rate HTTP boundary', () => {
  let app: INestApplication;

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
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('exposes the FX ingestion route behind the authentication guard', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/platform/pricing/fx-rates')
      .set('Idempotency-Key', 'c3-fx-unauthenticated-test-key')
      .send({})
      .expect(401);
  });
});
