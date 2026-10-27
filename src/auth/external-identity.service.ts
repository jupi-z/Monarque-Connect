import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, type ExternalIdentity } from '@prisma/client';
import type { EventContext } from '../events/event-context.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthPrincipal } from './auth.types.js';
import type { ExternalIdentityLinkIntent, VerifiedExternalIdentityProof } from './external-identity.types.js';
import { AuthService } from './auth.service.js';
import { PasswordReauthenticationProof } from './reauthentication-proof.js';

const LINK_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const IDENTICAL_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

type IdentityResult = Pick<ExternalIdentity, 'id' | 'status'>;
type IdentityAuditAction = 'EXTERNAL_IDENTITY_LINKED' | 'EXTERNAL_IDENTITY_REACTIVATED' | 'EXTERNAL_IDENTITY_REVOKED';

@Injectable()
export class ExternalIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly outbox: PrismaOutboxWriter,
  ) {}

  async beginExternalIdentityLink(principal: AuthPrincipal, currentPassword: string): Promise<ExternalIdentityLinkIntent> {
    const reauthentication = await this.auth.reauthenticateForSensitiveAction(principal, currentPassword);
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LINK_CHALLENGE_TTL_MS);
    const challengeId = randomUUID();

    await this.prisma.$transaction(async (tx) => {
      await this.lockAndAssertReauthentication(tx, reauthentication);
      await tx.externalIdentityLinkChallenge.create({
        data: {
          id: challengeId,
          userId: principal.userId,
          sessionId: principal.sessionId,
          stateHash: this.hash(state),
          nonceHash: this.hash(nonce),
          createdAt: now,
          expiresAt,
        },
      });
    });

    return { challengeId, state, nonce, expiresAt };
  }

  async completeExternalIdentityLink(proof: VerifiedExternalIdentityProof): Promise<IdentityResult> {
    this.assertProofShape(proof);
    const context = this.context();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "external_identity_link_challenges" WHERE "id" = ${proof.challengeId}::uuid FOR UPDATE`;
        const challenge = await tx.externalIdentityLinkChallenge.findUnique({ where: { id: proof.challengeId } });
        if (!challenge || !this.matchesProof(challenge.stateHash, proof.state) || !this.matchesProof(challenge.nonceHash, proof.nonce)) {
          throw new UnauthorizedException('External identity proof is invalid');
        }

        const now = new Date();
        if (challenge.consumedAt) {
          if (now.getTime() > challenge.expiresAt.getTime() + IDENTICAL_REPLAY_WINDOW_MS || !challenge.externalIdentityId) {
            throw new UnauthorizedException('External identity proof is no longer replayable');
          }
          await this.lockAndAssertActiveSession(tx, challenge.userId, challenge.sessionId);
          const linked = await tx.externalIdentity.findUnique({ where: { id: challenge.externalIdentityId } });
          if (!linked || linked.issuer !== proof.issuer || linked.subject !== proof.subject || linked.userId !== challenge.userId) {
            throw new UnauthorizedException('External identity proof replay diverges from the accepted command');
          }
          return { id: linked.id, status: linked.status };
        }

        if (challenge.expiresAt <= now
          || proof.verifiedAt < challenge.createdAt
          || proof.verifiedAt >= challenge.expiresAt
          || proof.verifiedAt.getTime() > now.getTime() + 60_000) {
          throw new UnauthorizedException('External identity proof has expired');
        }
        await this.lockAndAssertActiveSession(tx, challenge.userId, challenge.sessionId);

        const existing = await tx.externalIdentity.findUnique({ where: { issuer_subject: { issuer: proof.issuer, subject: proof.subject } } });
        if (existing && existing.userId !== challenge.userId) {
          throw new ConflictException('This external identity is already bound to another account');
        }
        if (existing?.status === 'ACTIVE') {
          throw new ConflictException('This external identity is already linked to this account');
        }

        const identityId = existing?.id ?? randomUUID();
        let identity: ExternalIdentity;
        let action: IdentityAuditAction;
        if (existing) {
          identity = await tx.externalIdentity.update({
            where: { id: existing.id },
            data: {
              status: 'ACTIVE',
              verifiedAt: proof.verifiedAt,
              revokedAt: null,
              revokedByUserId: null,
            },
          });
          action = 'EXTERNAL_IDENTITY_REACTIVATED';
        } else {
          identity = await tx.externalIdentity.create({
            data: {
              id: identityId,
              userId: challenge.userId,
              issuer: proof.issuer,
              subject: proof.subject,
              status: 'ACTIVE',
              verifiedAt: proof.verifiedAt,
              createdByUserId: challenge.userId,
            },
          });
          action = 'EXTERNAL_IDENTITY_LINKED';
        }

        await tx.externalIdentityLinkChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: now, externalIdentityId: identity.id },
        });
        await this.recordIdentityMutation(tx, action, challenge.userId, identity.id, proof.issuer, context);
        return { id: identity.id, status: identity.status };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This external identity or challenge has already been used');
      }
      throw error;
    }
  }

  async revokeExternalIdentity(principal: AuthPrincipal, identityId: string, currentPassword: string): Promise<IdentityResult> {
    const reauthentication = await this.auth.reauthenticateForSensitiveAction(principal, currentPassword);
    const context = this.context();
    return this.prisma.$transaction(async (tx) => {
      await this.lockAndAssertReauthentication(tx, reauthentication);
      const identity = await tx.externalIdentity.findFirst({ where: { id: identityId, userId: principal.userId } });
      if (!identity) throw new NotFoundException('External identity not found');
      if (identity.status === 'REVOKED') return { id: identity.id, status: identity.status };

      const now = new Date();
      const revoked = await tx.externalIdentity.update({
        where: { id: identity.id },
        data: { status: 'REVOKED', revokedAt: now, revokedByUserId: principal.userId },
      });
      await this.recordIdentityMutation(tx, 'EXTERNAL_IDENTITY_REVOKED', principal.userId, identity.id, identity.issuer, context);
      return { id: revoked.id, status: revoked.status };
    });
  }

  async resolveActiveExternalIdentity(issuer: string, subject: string): Promise<string> {
    this.assertIssuerSubject(issuer, subject);
    const identity = await this.prisma.externalIdentity.findUnique({
      where: { issuer_subject: { issuer, subject } },
      select: { userId: true, status: true, user: { select: { status: true } } },
    });
    if (!identity || identity.status !== 'ACTIVE' || identity.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('External identity is not active');
    }
    return identity.userId;
  }

  private async lockAndAssertReauthentication(tx: Prisma.TransactionClient, proof: PasswordReauthenticationProof): Promise<void> {
    const now = new Date();
    if (now.getTime() - proof.verifiedAt.getTime() > REAUTH_MAX_AGE_MS || proof.verifiedAt > now) {
      throw new UnauthorizedException('Recent password reauthentication is required');
    }
    await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "users" WHERE "id" = ${proof.userId}::uuid FOR UPDATE`;
    await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "refresh_sessions" WHERE "id" = ${proof.sessionId}::uuid AND "user_id" = ${proof.userId}::uuid FOR UPDATE`;
    const [user, session] = await Promise.all([
      tx.user.findUnique({ where: { id: proof.userId } }),
      tx.refreshSession.findFirst({ where: { id: proof.sessionId, userId: proof.userId } }),
    ]);
    if (!user || user.status !== 'ACTIVE' || !proof.matchesPasswordVerifier(user.passwordHash)
      || !session || session.revokedAt || session.replacedById || session.expiresAt <= now) {
      throw new UnauthorizedException('Recent password reauthentication is no longer valid');
    }
  }

  private async lockAndAssertActiveSession(tx: Prisma.TransactionClient, userId: string, sessionId: string): Promise<void> {
    await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
    await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "refresh_sessions" WHERE "id" = ${sessionId}::uuid AND "user_id" = ${userId}::uuid FOR UPDATE`;
    const [user, session] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { status: true } }),
      tx.refreshSession.findFirst({ where: { id: sessionId, userId, revokedAt: null, replacedById: null, expiresAt: { gt: new Date() } }, select: { id: true } }),
    ]);
    if (!user || user.status !== 'ACTIVE' || !session) throw new UnauthorizedException('The linking session is no longer active');
  }

  private async recordIdentityMutation(
    tx: Prisma.TransactionClient,
    action: IdentityAuditAction,
    actorUserId: string,
    identityId: string,
    issuer: string,
    context: EventContext,
  ): Promise<void> {
    const occurredAt = new Date().toISOString();
    const eventTypeByAction: Record<IdentityAuditAction, string> = {
      EXTERNAL_IDENTITY_LINKED: 'identity.external_identity.linked',
      EXTERNAL_IDENTITY_REACTIVATED: 'identity.external_identity.reactivated',
      EXTERNAL_IDENTITY_REVOKED: 'identity.external_identity.revoked',
    };
    const payload = { issuer };
    await tx.auditEvent.create({
      data: {
        id: randomUUID(),
        action,
        actorUserId,
        targetType: 'ExternalIdentity',
        targetId: identityId,
        requestId: context.requestId ?? null,
        correlationId: context.correlationId,
        metadataJson: payload as Prisma.InputJsonValue,
        occurredAt: new Date(occurredAt),
      },
    });
    await this.outbox.enqueue(tx, createDomainEvent({
      eventType: eventTypeByAction[action],
      eventVersion: 1,
      occurredAt,
      actor: { type: 'USER', id: actorUserId },
      aggregate: { type: 'ExternalIdentity', id: identityId },
      correlationId: context.correlationId,
      ...(context.requestId ? { requestId: context.requestId } : {}),
      dataClassification: 'CONFIDENTIAL',
      purpose: 'identity-tenancy-audit',
      payload,
    }));
  }

  private assertProofShape(proof: VerifiedExternalIdentityProof): void {
    if (!proof || typeof proof.challengeId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proof.challengeId)
      || typeof proof.state !== 'string' || typeof proof.nonce !== 'string'
      || !(proof.verifiedAt instanceof Date) || Number.isNaN(proof.verifiedAt.getTime())) {
      throw new UnauthorizedException('External identity proof is invalid');
    }
    this.assertIssuerSubject(proof.issuer, proof.subject);
    if (!/^[A-Za-z0-9_-]{43}$/.test(proof.state) || !/^[A-Za-z0-9_-]{43}$/.test(proof.nonce)) {
      throw new UnauthorizedException('External identity proof is invalid');
    }
  }

  private assertIssuerSubject(issuer: string, subject: string): void {
    if (typeof issuer !== 'string' || issuer.length === 0 || issuer.length > 2048
      || Buffer.byteLength(issuer, 'utf8') > 2048 || !/^[\x21-\x7e]+$/.test(issuer)
      || typeof subject !== 'string' || subject.length === 0 || subject.length > 255
      || Buffer.byteLength(subject, 'utf8') > 255 || !/^[\x01-\x7f]+$/.test(subject)) {
      throw new BadRequestException('External identity issuer or subject is invalid');
    }
    let parsed: URL;
    try {
      parsed = new URL(issuer);
    } catch {
      throw new BadRequestException('External identity issuer must be a valid HTTPS URL');
    }
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new BadRequestException('External identity issuer must be a valid HTTPS URL without query or fragment');
    }
  }

  private matchesProof(expectedHash: string, value: string): boolean {
    const actual = Buffer.from(this.hash(value), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
  private context() { return currentEventContext() ?? createRequestContext(); }
}
