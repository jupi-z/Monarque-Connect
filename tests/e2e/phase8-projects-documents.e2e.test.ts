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

const generateKeyPairAsync = promisify(generateKeyPair);
const password = 'correct horse battery staple';

describe('Phase 8 Projects & Documents HTTP E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let otherToken = '';
  let organizationId = '';
  let establishmentId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_phase8_e2e';
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-phase8-e2e';
    process.env.JWT_AUDIENCE = 'monarque-connect-phase8-api';
    process.env.JWT_KEY_ID = 'phase8-e2e';
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

    const suffix = Date.now();
    ownerToken = await registerAndLogin(`phase8-owner-${suffix}@example.com`, 'Phase8 Owner');
    const organization = bodyOf<{ id: string; establishment: { id: string } }>(await request(server()).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Phase 8 E2E Organization', handle: `phase8-${suffix}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201));
    organizationId = organization.id;
    establishmentId = organization.establishment.id;
    const plan = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } }, select: { id: true } });
    await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: plan.id } });
    otherToken = await registerAndLogin(`phase8-other-${suffix}@example.com`, 'Phase8 Other');
  }, 60000);

  afterAll(async () => {
    if (organizationId) await prisma.organization.delete({ where: { id: organizationId } });
    if (app) await app.close();
  });

  it('executes project, task and document workflows transactionally', async () => {
    const projectPayload = { establishmentId, name: 'Implementation project', description: 'Phase 8 E2E' };
    const firstProject = bodyOf<{ id: string; status: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/projects`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase8-project-create').send(projectPayload).expect(201));
    expect(firstProject.status).toBe('PLANNED');
    const replayedProject = bodyOf<{ id: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/projects`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase8-project-create').send(projectPayload).expect(201));
    expect(replayedProject.id).toBe(firstProject.id);
    await request(server()).post(`/api/v1/organizations/${organizationId}/projects`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase8-project-create').send({ ...projectPayload, name: 'Different payload' }).expect(409);

    await request(server()).post(`/api/v1/organizations/${organizationId}/projects/${firstProject.id}/transition`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase8-project-active').send({ status: 'ACTIVE' }).expect(200);
    const task = bodyOf<{ id: string; status: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/projects/${firstProject.id}/tasks`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase8-task-create').send({ title: 'Prepare project documents' }).expect(201));
    expect(task.status).toBe('TODO');
    const tasks = bodyOf<{ items: Array<{ id: string }> }>(await request(server()).get(`/api/v1/organizations/${organizationId}/projects/${firstProject.id}/tasks`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(tasks.items.map((item) => item.id)).toContain(task.id);

    const upload = bodyOf<{ document: { id: string; status: string; links: Array<{ targetId: string }> }; uploadToken: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/documents/uploads`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase8-document-start').send({ establishmentId, originalFilename: 'brief.txt', mediaType: 'text/plain', byteSize: 5, classification: 'CONFIDENTIAL', links: [{ targetType: 'PROJECT', targetId: firstProject.id }] }).expect(201));
    expect(upload.document.status).toBe('PENDING_UPLOAD');
    expect(upload.document.links).toEqual(expect.arrayContaining([expect.objectContaining({ targetId: firstProject.id })]));
    expect(upload.uploadToken).toBeTruthy();

    const document = bodyOf<{ id: string; status: string; checksumSha256: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/documents/${upload.document.id}/complete`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase8-document-complete').send({ checksumSha256: 'a'.repeat(64), byteSize: 5 }).expect(200));
    expect(document).toMatchObject({ id: upload.document.id, status: 'AVAILABLE', checksumSha256: 'a'.repeat(64) });
    await request(server()).get(`/api/v1/organizations/${organizationId}/documents/${document.id}/content`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const listed = bodyOf<{ items: Array<{ id: string }> }>(await request(server()).get(`/api/v1/organizations/${organizationId}/documents?targetType=PROJECT&targetId=${firstProject.id}`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(listed.items.map((item) => item.id)).toContain(document.id);
    await request(server()).post(`/api/v1/organizations/${organizationId}/documents/${document.id}/revoke`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase8-document-revoke').send({ reason: 'E2E cleanup' }).expect(200);
  });

  it('enforces tenant isolation for projects and documents', async () => {
    await request(server()).get(`/api/v1/organizations/${organizationId}/projects`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    await request(server()).get(`/api/v1/organizations/${organizationId}/documents`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    await request(server()).get(`/api/v1/organizations/${organizationId}/projects`).expect(401);
  });

  async function registerAndLogin(email: string, name: string): Promise<string> {
    const [firstName, lastName] = name.split(' ');
    const registration = await request(server()).post('/api/v1/auth/register').send({ email, password, firstName, lastName }).expect(201);
    const login = await request(server()).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(registration).email, password }).expect(200);
    return bodyOf<{ accessToken: string }>(login).accessToken;
  }

  function server(): Parameters<typeof request>[0] { return app.getHttpServer() as Parameters<typeof request>[0]; }
});

function bodyOf<T>(response: Response): T { return response.body as T; }
