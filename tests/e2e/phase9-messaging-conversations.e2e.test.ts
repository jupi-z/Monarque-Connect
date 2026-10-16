import { randomUUID } from 'node:crypto';
import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import { exportPKCS8, exportSPKI } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ProblemDetailsFilter } from '../../src/http/problem-details.filter.js';
import { seedReferenceData } from '../../prisma/seed.js';

const generateKeyPairAsync = promisify(generateKeyPair);

describe('Phase 9 conversation and invitation HTTP flow', () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_phase9_task3_test';
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerOneToken = '';
  let ownerTwoToken = '';
  let ownerOneOrganizationId = '';
  let ownerTwoOrganizationId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = connectionString;
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-test';
    process.env.JWT_AUDIENCE = 'monarque-connect-api-test';
    process.env.JWT_KEY_ID = 'phase9-task3';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE messaging_command_receipts, messaging_invitations, conversation_user_participants, conversation_organization_participants, messages, messaging_organization_blocks, messaging_rate_buckets, conversations RESTART IDENTITY CASCADE');
    await prisma.auditEvent.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.membershipEstablishmentScope.deleteMany();
    await prisma.invitationEstablishmentScope.deleteMany();
    await prisma.invitation.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.establishment.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.refreshSession.deleteMany();
    await prisma.user.deleteMany();
    await prisma.loginRateLimitBucket.deleteMany();
    await seedReferenceData(prisma);
    const server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
    const ownerOne = await registerAndLogin(server, 'phase9-task3-one@example.test');
    ownerOneToken = ownerOne.token;
    const ownerTwo = await registerAndLogin(server, 'phase9-task3-two@example.test');
    ownerTwoToken = ownerTwo.token;
    ownerOneOrganizationId = bodyOf<{ id: string }>(await request(server).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerOneToken}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Messaging One', handle: `msg-one-${randomUUID().slice(0, 8)}`, defaultCurrency: 'EUR', establishmentName: 'One office' }).expect(201)).id;
    ownerTwoOrganizationId = bodyOf<{ id: string }>(await request(server).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerTwoToken}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Messaging Two', handle: `msg-two-${randomUUID().slice(0, 8)}`, defaultCurrency: 'EUR', establishmentName: 'Two office' }).expect(201)).id;
    await request(server).patch(`/api/v1/organizations/${ownerOneOrganizationId}/network-profile`).set('Authorization', `Bearer ${ownerOneToken}`).send({ isPublic: true }).expect(200);
    await request(server).patch(`/api/v1/organizations/${ownerTwoOrganizationId}/network-profile`).set('Authorization', `Bearer ${ownerTwoToken}`).send({ isPublic: true }).expect(200);
    const connection = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${ownerOneOrganizationId}/connection-requests`).set('Authorization', `Bearer ${ownerOneToken}`).send({ targetOrganizationId: ownerTwoOrganizationId }).expect(201));
    await request(server).patch(`/api/v1/organizations/${ownerTwoOrganizationId}/connection-requests/${connection.id}`).set('Authorization', `Bearer ${ownerTwoToken}`).send({ status: 'ACCEPTED' }).expect(200);
    await prisma.organizationNetworkTrust.upsert({ where: { organizationId: ownerOneOrganizationId }, update: { verificationStatus: 'VERIFIED', verifiedAt: new Date(), verificationExpiresAt: null }, create: { id: randomUUID(), organizationId: ownerOneOrganizationId, verificationStatus: 'VERIFIED', verifiedAt: new Date(), verificationExpiresAt: null } });
  });

  afterAll(async () => { if (app) await app.close(); });

  it('creates a bilateral conversation idempotently and exposes only invitation metadata before acceptance', async () => {
    const server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
    const payload = { targetOrganizationId: ownerTwoOrganizationId };
    const first = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${ownerOneOrganizationId}/conversations`).set('Authorization', `Bearer ${ownerOneToken}`).set('Idempotency-Key', 'phase9-task3-conversation').send(payload).expect(201));
    const replay = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${ownerOneOrganizationId}/conversations`).set('Authorization', `Bearer ${ownerOneToken}`).set('Idempotency-Key', 'phase9-task3-conversation').send(payload).expect(201));
    expect(replay.id).toBe(first.id);
    await request(server).post(`/api/v1/organizations/${ownerOneOrganizationId}/conversations`).set('Authorization', `Bearer ${ownerOneToken}`).set('Idempotency-Key', 'phase9-task3-conversation').send({ targetOrganizationId: ownerTwoOrganizationId, sourceEstablishmentId: randomUUID() }).expect(409);
    const invitations = bodyOf<{ items: Array<{ id: string; token?: string }> }>(await request(server).get(`/api/v1/organizations/${ownerTwoOrganizationId}/conversation-invitations`).set('Authorization', `Bearer ${ownerTwoToken}`).expect(200));
    expect(invitations.items).toHaveLength(1);
    expect(invitations.items[0]).not.toHaveProperty('token');
    const token = bodyOf<{ token: string; invitationId: string }>(await request(server).post(`/api/v1/organizations/${ownerTwoOrganizationId}/conversation-invitations/${invitations.items[0]!.id}/token`).set('Authorization', `Bearer ${ownerTwoToken}`).expect(200));
    await request(server).post(`/api/v1/organizations/${ownerTwoOrganizationId}/conversations/${first.id}/participant-invitations`).set('Authorization', `Bearer ${ownerTwoToken}`).set('Idempotency-Key', 'phase9-task3-cross-tenant').send({ userId: randomUUID() }).expect(404);
    await request(server).post(`/api/v1/organizations/${ownerTwoOrganizationId}/conversation-invitations/${token.invitationId}/accept`).set('Authorization', `Bearer ${ownerTwoToken}`).set('Idempotency-Key', 'phase9-task3-accept').send({ token: token.token }).expect(200);
    await request(server).get(`/api/v1/organizations/${ownerTwoOrganizationId}/conversations/${first.id}`).set('Authorization', `Bearer ${ownerTwoToken}`).expect(404);
    const participantInvitation = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${ownerTwoOrganizationId}/conversations/${first.id}/participant-invitations`).set('Authorization', `Bearer ${ownerTwoToken}`).set('Idempotency-Key', 'phase9-task4-participant-invite').send({ userId: (await prisma.membership.findFirstOrThrow({ where: { organizationId: ownerTwoOrganizationId }, select: { userId: true } })).userId }).expect(201));
    const userInvitationToken = bodyOf<{ token: string; invitationId: string }>(await request(server).post(`/api/v1/organizations/${ownerTwoOrganizationId}/conversation-invitations/${participantInvitation.id}/token`).set('Authorization', `Bearer ${ownerTwoToken}`).expect(200));
    await request(server).post(`/api/v1/organizations/${ownerTwoOrganizationId}/conversation-invitations/${participantInvitation.id}/accept`).set('Authorization', `Bearer ${ownerTwoToken}`).set('Idempotency-Key', 'phase9-task4-participant-accept').send({ token: userInvitationToken.token }).expect(200);
    const message = bodyOf<{ id: string; sequence: number }>(await request(server).post(`/api/v1/organizations/${ownerOneOrganizationId}/conversations/${first.id}/messages`).set('Authorization', `Bearer ${ownerOneToken}`).set('Idempotency-Key', 'phase9-task4-message').send({ clientMessageId: 'client-message-1', body: 'Bonjour depuis la vente' }).expect(201));
    const messageReplay = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${ownerOneOrganizationId}/conversations/${first.id}/messages`).set('Authorization', `Bearer ${ownerOneToken}`).set('Idempotency-Key', 'phase9-task4-message').send({ clientMessageId: 'client-message-1', body: 'Bonjour depuis la vente' }).expect(201));
    expect(messageReplay.id).toBe(message.id);
    await request(server).post(`/api/v1/organizations/${ownerOneOrganizationId}/conversations/${first.id}/messages`).set('Authorization', `Bearer ${ownerOneToken}`).set('Idempotency-Key', 'phase9-task4-message').send({ clientMessageId: 'client-message-1', body: 'Commande divergente' }).expect(409);
    const messages = bodyOf<{ items: Array<{ id: string; sequence: number; authorUserId: string; sourceOrganizationId: string }> }>(await request(server).get(`/api/v1/organizations/${ownerTwoOrganizationId}/conversations/${first.id}/messages`).set('Authorization', `Bearer ${ownerTwoToken}`).expect(200));
    expect(messages.items).toHaveLength(1);
    expect(messages.items[0]).toMatchObject({ id: message.id, sequence: 1, sourceOrganizationId: ownerOneOrganizationId });
    await expect(prisma.$executeRawUnsafe('UPDATE messages SET body = $1 WHERE id = $2', 'tampered', message.id)).rejects.toThrow('message_immutable');
    await expect(prisma.$executeRawUnsafe('DELETE FROM messages WHERE id = $1', message.id)).rejects.toThrow('message_immutable');
    await expect(prisma.outboxEvent.count({ where: { eventType: 'messaging.message.sent.v1' } })).resolves.toBe(1);
    await expect(prisma.messagingInvitation.count({ where: { conversationId: first.id, status: 'ACCEPTED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { eventType: 'messaging.organization_invitation.accepted.v1' } })).resolves.toBe(1);
  });
});

async function registerAndLogin(server: Parameters<typeof request>[0], email: string): Promise<{ token: string; userId: string }> {
  const password = 'correct horse battery staple';
  const registration = bodyOf<{ id: string; email: string }>(await request(server).post('/api/v1/auth/register').send({ email, password, firstName: 'Messaging', lastName: 'Owner' }).expect(201));
  const login = bodyOf<{ accessToken: string }>(await request(server).post('/api/v1/auth/login').send({ identifier: registration.email, password }).expect(200));
  return { token: login.accessToken, userId: registration.id };
}

function bodyOf<T>(response: Response): T { return response.body as T; }
