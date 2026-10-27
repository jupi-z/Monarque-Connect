import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { exportPKCS8, exportSPKI } from 'jose';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../../src/auth/auth.service.js';
import { ExternalIdentityService } from '../../src/auth/external-identity.service.js';
import type { VerifiedExternalIdentityProof } from '../../src/auth/external-identity.types.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { LoginRateLimiter } from '../../src/auth/login-rate-limiter.service.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';

const generateKeyPairAsync = promisify(generateKeyPair);
const PASSWORD = 'correct horse battery staple';
const ISSUER = 'https://identity.example.test';

describe('External identity persistence and account linking', () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const outbox = new PrismaOutboxWriter();
  let auth: AuthService;
  let identities: ExternalIdentityService;
  let userId: string;
  let sessionId: string;
  let issuerForTest: string;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const config = new ConfigService({
      JWT_ISSUER: 'monarque-connect-test', JWT_AUDIENCE: 'monarque-connect-api-test', JWT_KEY_ID: 'c2-test-key',
      JWT_PRIVATE_KEY_PEM: await exportPKCS8(privateKey), JWT_PUBLIC_KEY_PEM: await exportSPKI(publicKey),
    });
    const prismaService = prisma as never;
    auth = new AuthService(prismaService, new PasswordService(), new TokenService(config), outbox, new LoginRateLimiter(prismaService));
    identities = new ExternalIdentityService(prismaService, auth, outbox);
    await prisma.$connect();
  });

  beforeEach(async () => {
    issuerForTest = `${ISSUER}/${crypto.randomUUID()}`;
    const user = await auth.register({ email: `identity-${crypto.randomUUID()}@example.test`, password: PASSWORD, firstName: 'Identity', lastName: 'Owner' });
    const tokens = await auth.login({ identifier: user.email, password: PASSWORD });
    userId = user.id;
    sessionId = tokens.sessionId;
  });

  afterAll(async () => prisma.$disconnect());

  function principal(forUserId = userId, forSessionId = sessionId) {
    return { userId: forUserId, sessionId: forSessionId };
  }

  async function beginLink(forPrincipal = principal()) {
    return identities.beginExternalIdentityLink(forPrincipal, PASSWORD);
  }

  async function complete(
    intent: Awaited<ReturnType<typeof beginLink>>,
    subject: string,
    issuer = issuerForTest,
    verifiedAt = new Date(),
  ) {
    const proof = {
      challengeId: intent.challengeId,
      state: intent.state,
      nonce: intent.nonce,
      issuer,
      subject,
      verifiedAt,
    } as VerifiedExternalIdentityProof;
    return identities.completeExternalIdentityLink(proof);
  }

  it('stores only state and nonce hashes and refuses a wrong reauthentication password', async () => {
    await expect(identities.beginExternalIdentityLink(principal(), 'wrong password')).rejects.toThrow();
    const intent = await beginLink();
    const challenge = await prisma.externalIdentityLinkChallenge.findUniqueOrThrow({ where: { id: intent.challengeId } });
    expect(challenge.stateHash).toBe(createHash('sha256').update(intent.state).digest('hex'));
    expect(challenge.nonceHash).toBe(createHash('sha256').update(intent.nonce).digest('hex'));
    expect(challenge.stateHash).not.toBe(intent.state);
    expect(challenge.nonceHash).not.toBe(intent.nonce);
    expect(challenge.userId).toBe(userId);
    expect(challenge.sessionId).toBe(sessionId);
    expect(challenge.expiresAt.getTime() - challenge.createdAt.getTime()).toBe(10 * 60 * 1000);
  });

  it('links the exact issuer and subject to the authenticated internal user without email matching', async () => {
    const emailOwner = await auth.register({ email: `same-as-subject-${crypto.randomUUID()}@example.test`, password: PASSWORD, firstName: 'Email', lastName: 'Owner' });
    const intent = await beginLink();
    const identity = await complete(intent, emailOwner.email);
    expect(identity).toMatchObject({ status: 'ACTIVE' });
    const stored = await prisma.externalIdentity.findUniqueOrThrow({ where: { id: identity.id } });
    expect(stored).toMatchObject({ issuer: issuerForTest, subject: emailOwner.email });
    expect(stored.userId).toBe(userId);
    expect(stored.userId).not.toBe(emailOwner.id);
    await expect(identities.resolveActiveExternalIdentity(issuerForTest, emailOwner.email)).resolves.toBe(userId);
    await expect(prisma.auditEvent.findFirst({ where: { action: 'EXTERNAL_IDENTITY_LINKED', targetId: identity.id } })).resolves.toMatchObject({
      actorUserId: userId,
      metadataJson: { issuer: issuerForTest },
    });
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'identity.external_identity.linked', aggregateId: identity.id } });
    expect(event).toMatchObject({ eventVersion: 1, dataClassification: 'CONFIDENTIAL' });
    expect(event.payloadJson).toEqual({ issuer: issuerForTest });
    expect(JSON.stringify(event.payloadJson)).not.toContain(emailOwner.email);
    expect(JSON.stringify(event.payloadJson)).not.toContain(userId);
  });

  it('uses case-sensitive issuer and subject keys and rejects malformed untrusted proof values', async () => {
    await complete(await beginLink(), 'CaseSensitive');
    await complete(await beginLink(), 'casesensitive');
    await complete(await beginLink(), 'https://identity.example.test', `${issuerForTest}/tenant`);
    await expect(complete(await beginLink(), 'non-ascii-😀')).rejects.toThrow();
    await expect(complete(await beginLink(), 'missing-issuer', 'http://identity.example.test')).rejects.toThrow();
    expect(await prisma.externalIdentity.count({ where: { issuer: issuerForTest } })).toBe(2);
  });

  it('makes an identical consumed proof idempotent and rejects a divergent replay', async () => {
    const intent = await beginLink();
    const proof = {
      challengeId: intent.challengeId,
      state: intent.state,
      nonce: intent.nonce,
      issuer: issuerForTest,
      subject: 'replay-subject',
      verifiedAt: new Date(),
    } as VerifiedExternalIdentityProof;
    const linked = await identities.completeExternalIdentityLink(proof);
    const auditCount = await prisma.auditEvent.count({ where: { action: 'EXTERNAL_IDENTITY_LINKED', targetId: linked.id } });
    const outboxCount = await prisma.outboxEvent.count({ where: { eventType: 'identity.external_identity.linked', aggregateId: linked.id } });
    const replay = await identities.completeExternalIdentityLink(proof);
    expect(replay.id).toBe(linked.id);
    await expect(complete(intent, 'different-subject')).rejects.toThrow();
    await expect(prisma.auditEvent.count({ where: { action: 'EXTERNAL_IDENTITY_LINKED', targetId: linked.id } })).resolves.toBe(auditCount);
    await expect(prisma.outboxEvent.count({ where: { eventType: 'identity.external_identity.linked', aggregateId: linked.id } })).resolves.toBe(outboxCount);
  });

  it('rejects a state or nonce mismatch without consuming the challenge', async () => {
    const intent = await beginLink();
    await expect(identities.completeExternalIdentityLink({
      challengeId: 'not-a-uuid', state: intent.state, nonce: intent.nonce,
      issuer: issuerForTest, subject: 'malformed-challenge-id', verifiedAt: new Date(),
    })).rejects.toThrow();
    await expect(complete({ ...intent, state: 'A'.repeat(43) }, 'state-mismatch')).rejects.toThrow();
    await expect(complete({ ...intent, nonce: 'B'.repeat(43) }, 'nonce-mismatch')).rejects.toThrow();
    await expect(prisma.externalIdentityLinkChallenge.findUniqueOrThrow({ where: { id: intent.challengeId } })).resolves.toMatchObject({ consumedAt: null, externalIdentityId: null });
  });

  it('preserves revoked issuer/subject ownership and allows only same-owner relinking', async () => {
    const identity = await complete(await beginLink(), 'permanent-owner');
    await expect(prisma.externalIdentity.update({ where: { id: identity.id }, data: {
      status: 'REVOKED', verifiedAt: new Date(Date.now() + 1_000), revokedAt: new Date(), revokedByUserId: userId,
    } })).rejects.toThrow();
    await identities.revokeExternalIdentity(principal(), identity.id, PASSWORD);
    await identities.revokeExternalIdentity(principal(), identity.id, PASSWORD);
    await expect(prisma.auditEvent.count({ where: { action: 'EXTERNAL_IDENTITY_REVOKED', targetId: identity.id } })).resolves.toBe(1);
    await expect(identities.resolveActiveExternalIdentity(issuerForTest, 'permanent-owner')).rejects.toThrow();
    const relinked = await complete(await beginLink(), 'permanent-owner');
    expect(relinked.id).toBe(identity.id);
    expect(relinked.status).toBe('ACTIVE');
    await expect(prisma.auditEvent.count({ where: { action: 'EXTERNAL_IDENTITY_REACTIVATED', targetId: identity.id } })).resolves.toBe(1);

    const second = await auth.register({ email: `other-${crypto.randomUUID()}@example.test`, password: PASSWORD, firstName: 'Other', lastName: 'Owner' });
    const secondTokens = await auth.login({ identifier: second.email, password: PASSWORD });
    await expect(complete(await beginLink(principal(second.id, secondTokens.sessionId)), 'permanent-owner')).rejects.toThrow();
    await expect(identities.revokeExternalIdentity(principal(second.id, secondTokens.sessionId), identity.id, PASSWORD)).rejects.toThrow();
    expect(await prisma.externalIdentity.count({ where: { issuer: issuerForTest, subject: 'permanent-owner' } })).toBe(1);
  });

  it('accepts the maximum ASCII index key and enforces immutable ownership and tombstones in PostgreSQL', async () => {
    const prefix = 'https://identity.example.test/';
    const maxIssuer = `${prefix}${'i'.repeat(2048 - prefix.length)}`;
    const maxSubject = 's'.repeat(255);
    const identity = await complete(await beginLink(), maxSubject, maxIssuer);
    await expect(prisma.externalIdentity.findUniqueOrThrow({ where: { id: identity.id } })).resolves.toMatchObject({ issuer: maxIssuer, subject: maxSubject });

    const other = await auth.register({ email: `immutable-${crypto.randomUUID()}@example.test`, password: PASSWORD, firstName: 'Other', lastName: 'User' });
    await expect(prisma.externalIdentity.update({ where: { id: identity.id }, data: { userId: other.id } })).rejects.toThrow();
    await expect(prisma.externalIdentity.update({ where: { id: identity.id }, data: { subject: 'changed' } })).rejects.toThrow();
    const challenge = await prisma.externalIdentityLinkChallenge.findFirstOrThrow({ where: { externalIdentityId: identity.id } });
    await expect(prisma.externalIdentityLinkChallenge.update({ where: { id: challenge.id }, data: { stateHash: 'a'.repeat(64) } })).rejects.toThrow();
    await prisma.externalIdentityLinkChallenge.delete({ where: { id: challenge.id } });
    await expect(prisma.externalIdentity.delete({ where: { id: identity.id } })).rejects.toThrow();

    await expect(prisma.externalIdentity.create({ data: {
      id: crypto.randomUUID(), userId, issuer: 'https://identity.example.test/é', subject: 'ascii-subject',
      status: 'ACTIVE', verifiedAt: new Date(), createdByUserId: userId,
    } })).rejects.toThrow();
  });

  it('rejects an expired verifier proof without consuming the challenge', async () => {
    const intent = await beginLink();
    await expect(complete(intent, 'expired-subject', ISSUER, intent.expiresAt)).rejects.toThrow();
    await expect(prisma.externalIdentityLinkChallenge.findUniqueOrThrow({ where: { id: intent.challengeId } })).resolves.toMatchObject({ consumedAt: null, externalIdentityId: null });
  });

  it('rejects linking or revoking through an inactive or foreign session', async () => {
    const intent = await beginLink();
    await auth.logout(principal());
    await expect(complete(intent, 'logged-out-session')).rejects.toThrow();
    await expect(beginLink()).rejects.toThrow();
  });

  it('revalidates the password verifier after reauthentication before persisting a challenge', async () => {
    const originalReauthenticate = auth.reauthenticateForSensitiveAction.bind(auth);
    const reauthenticate = vi.spyOn(auth, 'reauthenticateForSensitiveAction').mockImplementationOnce(async (actor, password) => {
      const proof = await originalReauthenticate(actor, password);
      await auth.changePassword(principal(), { currentPassword: PASSWORD, newPassword: 'another strong password 2026!' });
      return proof;
    });
    try {
      await expect(beginLink()).rejects.toThrow();
    } finally {
      reauthenticate.mockRestore();
    }
    await expect(prisma.externalIdentityLinkChallenge.count({ where: { userId } })).resolves.toBe(0);
  });

  it('serializes concurrent claims so one external identity cannot be owned by two users', async () => {
    const second = await auth.register({ email: `concurrent-${crypto.randomUUID()}@example.test`, password: PASSWORD, firstName: 'Concurrent', lastName: 'Owner' });
    const secondTokens = await auth.login({ identifier: second.email, password: PASSWORD });
    const firstIntent = await beginLink();
    const secondIntent = await beginLink(principal(second.id, secondTokens.sessionId));
    const results = await Promise.allSettled([
      complete(firstIntent, 'concurrent-subject'),
      complete(secondIntent, 'concurrent-subject'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.externalIdentity.count({ where: { issuer: issuerForTest, subject: 'concurrent-subject' } })).toBe(1);
  });

  it('enforces same-user ownership between challenges, sessions, and linked identities in PostgreSQL', async () => {
    const second = await auth.register({ email: `cross-link-${crypto.randomUUID()}@example.test`, password: PASSWORD, firstName: 'Cross', lastName: 'Owner' });
    const secondTokens = await auth.login({ identifier: second.email, password: PASSWORD });
    const foreignIdentity = await complete(await beginLink(principal(second.id, secondTokens.sessionId)), 'foreign-challenge-owner');
    const now = new Date();
    const challenge = {
      id: crypto.randomUUID(), stateHash: createHash('sha256').update(crypto.randomUUID()).digest('hex'),
      nonceHash: createHash('sha256').update(crypto.randomUUID()).digest('hex'),
      createdAt: now, expiresAt: new Date(now.getTime() + 60_000),
    };

    await expect(prisma.externalIdentityLinkChallenge.create({ data: {
      ...challenge, userId, sessionId: secondTokens.sessionId,
    } })).rejects.toThrow();

    await expect(prisma.externalIdentityLinkChallenge.create({ data: {
      ...challenge, id: crypto.randomUUID(), userId, sessionId,
      consumedAt: now, externalIdentityId: foreignIdentity.id,
    } })).rejects.toThrow();
  });

  it('rolls back the identity and challenge consumption when the outbox write fails', async () => {
    const intent = await beginLink();
    const enqueue = vi.spyOn(outbox, 'enqueue').mockRejectedValueOnce(new Error('simulated outbox write failure'));
    try {
      await expect(complete(intent, 'atomic-subject')).rejects.toThrow('simulated outbox write failure');
    } finally {
      enqueue.mockRestore();
    }
    await expect(prisma.externalIdentity.count({ where: { issuer: issuerForTest, subject: 'atomic-subject' } })).resolves.toBe(0);
    await expect(prisma.externalIdentityLinkChallenge.findUniqueOrThrow({ where: { id: intent.challengeId } })).resolves.toMatchObject({ consumedAt: null, externalIdentityId: null });
  });
});
