import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { EventContext } from '../events/event-context.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { PrismaService } from '../database/prisma.service.js';
import { normalizeEmail } from './identity.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import type { AuthPrincipal } from './auth.types.js';
import type { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto } from './auth.dto.js';
import { LoginRateLimiter } from './login-rate-limiter.service.js';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly outbox: PrismaOutboxWriter,
    private readonly loginRateLimiter: LoginRateLimiter,
  ) {}

  async register(input: RegisterDto): Promise<{ id: string; email: string; firstName: string; lastName: string }> {
    const normalizedEmail = normalizeEmail(input.email);
    const passwordHash = await this.passwords.hash(input.password);
    const userId = randomUUID();
    const context = this.context();
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            id: userId,
            email: input.email.trim(),
            normalizedEmail,
            ...(input.phone ? { phone: input.phone.trim() } : {}),
            passwordHash,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
          },
        });
        await this.recordAuditAndEvent(tx, 'USER_REGISTERED', userId, undefined, context, {
          aggregateType: 'User', aggregateId: userId, payload: { email: normalizedEmail },
        });
        return created;
      });
      return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with these credentials already exists');
      }
      throw error;
    }
  }

  async login(input: LoginDto, ipAddress = 'unknown'): Promise<TokenPair> {
    const normalizedEmail = normalizeEmail(input.identifier);
    await this.loginRateLimiter.assertAllowed(normalizedEmail, ipAddress);
    const user = await this.prisma.user.findUnique({ where: { normalizedEmail } });
    const valid = user ? await this.passwords.verify(user.passwordHash, input.password) : false;
    if (!user || !valid || user.status !== 'ACTIVE') {
      await this.loginRateLimiter.recordFailure(normalizedEmail, ipAddress);
      if (user) await this.recordLoginFailure(user.id, this.context());
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.loginRateLimiter.recordSuccess(normalizedEmail, ipAddress);
    return this.createSession(user.id, this.context(), 'USER_LOGIN_SUCCEEDED');
  }

  async refresh(input: RefreshDto): Promise<TokenPair> {
    const tokenHash = this.hashOpaqueToken(input.refreshToken);
    const context = this.context();
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.refreshSession.findUnique({ where: { tokenHash }, include: { user: true } });
      if (!session) throw new UnauthorizedException('Invalid refresh token');
      const now = new Date();
      if (session.revokedAt || session.replacedById || session.expiresAt <= now || session.user.status !== 'ACTIVE') {
        await tx.refreshSession.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: now } });
        await this.recordAuditAndEvent(tx, 'SESSION_REPLAY_REVOKED', session.userId, undefined, context, {
          aggregateType: 'RefreshSession', aggregateId: session.id, payload: { familyId: session.familyId },
        });
        throw new UnauthorizedException('Invalid refresh token');
      }
      const replacement = this.newOpaqueToken();
      const replacementId = randomUUID();
      await tx.refreshSession.create({
        data: {
          id: replacementId, userId: session.userId, familyId: session.familyId,
          tokenHash: this.hashOpaqueToken(replacement), expiresAt: this.refreshExpiry(),
        },
      });
      await tx.refreshSession.update({ where: { id: session.id }, data: { revokedAt: now, replacedById: replacementId, lastUsedAt: now } });
      const accessToken = await this.tokens.signAccessToken({ sub: session.userId, sid: replacementId, jti: randomUUID() });
      await this.recordAuditAndEvent(tx, 'SESSION_REFRESHED', session.userId, undefined, context, {
        aggregateType: 'RefreshSession', aggregateId: replacementId, payload: { familyId: session.familyId },
      });
      return { accessToken, refreshToken: replacement, sessionId: replacementId };
    });
  }

  async logout(principal: AuthPrincipal): Promise<void> {
    await this.prisma.refreshSession.updateMany({ where: { id: principal.sessionId, userId: principal.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async changePassword(principal: AuthPrincipal, input: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: principal.userId } });
    if (!user || user.status !== 'ACTIVE' || !(await this.passwords.verify(user.passwordHash, input.currentPassword))) throw new UnauthorizedException('Invalid credentials');
    const passwordHash = await this.passwords.hash(input.newPassword);
    const context = this.context();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: principal.userId }, data: { passwordHash } });
      await tx.refreshSession.updateMany({ where: { userId: principal.userId, id: { not: principal.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.recordAuditAndEvent(tx, 'SESSION_REVOKED', principal.userId, undefined, context, { aggregateType: 'User', aggregateId: principal.userId, payload: { reason: 'password_changed' } });
    });
  }

  async me(principal: AuthPrincipal): Promise<{ id: string; email: string; firstName: string; lastName: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: principal.userId } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName };
  }

  private async createSession(userId: string, context: EventContext, action: 'USER_LOGIN_SUCCEEDED'): Promise<TokenPair> {
    const refreshToken = this.newOpaqueToken();
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const accessToken = await this.tokens.signAccessToken({ sub: userId, sid: sessionId, jti: randomUUID() });
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshSession.create({ data: { id: sessionId, userId, familyId, tokenHash: this.hashOpaqueToken(refreshToken), expiresAt: this.refreshExpiry() } });
      await this.recordAuditAndEvent(tx, action, userId, undefined, context, {
        aggregateType: 'RefreshSession', aggregateId: sessionId, payload: { familyId },
      });
    });
    return { accessToken, refreshToken, sessionId };
  }

  private async recordLoginFailure(userId: string, context: EventContext): Promise<void> {
    await this.prisma.$transaction((tx) => this.recordAuditAndEvent(tx, 'USER_LOGIN_FAILED', userId, undefined, context, {
      aggregateType: 'User', aggregateId: userId, payload: {},
    }));
  }

  private async recordAuditAndEvent(
    tx: Prisma.TransactionClient,
    action: Parameters<Prisma.TransactionClient['auditEvent']['create']>[0]['data']['action'],
    actorUserId: string | undefined,
    organizationId: string | undefined,
    context: EventContext,
    event: { aggregateType: string; aggregateId: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await tx.auditEvent.create({ data: {
      id: randomUUID(), action, actorUserId: actorUserId ?? null, organizationId: organizationId ?? null,
      targetType: event.aggregateType, targetId: event.aggregateId, requestId: context.requestId ?? null,
      correlationId: context.correlationId, metadataJson: event.payload as Prisma.InputJsonValue,
    } });
    await this.outbox.enqueue(tx, createDomainEvent({
      eventType: `identity.${action.toLowerCase().replaceAll('_', '.')}`,
      eventVersion: 1, occurredAt: new Date().toISOString(),
      actor: actorUserId ? { type: 'USER', id: actorUserId } : { type: 'SYSTEM' },
      aggregate: { type: event.aggregateType, id: event.aggregateId }, correlationId: context.correlationId,
      ...(context.requestId ? { requestId: context.requestId } : {}),
      dataClassification: 'CONFIDENTIAL', purpose: 'identity-tenancy-audit', payload: event.payload,
    }));
  }

  private context(): EventContext { return currentEventContext() ?? createRequestContext(); }
  private newOpaqueToken(): string { return randomBytes(32).toString('base64url'); }
  private hashOpaqueToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  private refreshExpiry(): Date { return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); }
}
