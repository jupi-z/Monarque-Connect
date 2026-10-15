import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type NetworkVerificationStatus } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { PlatformAuthorizationService } from '../entitlements/platform-authorization.service.js';
import type { SetNetworkTrustCommandDto } from './network-trust-command.dto.js';

@Injectable()
export class NetworkTrustCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: PrismaOutboxWriter,
    private readonly platformAuthorization: PlatformAuthorizationService,
  ) {}

  async set(principal: AuthPrincipal, organizationId: string, input: SetNetworkTrustCommandDto, idempotencyKey?: string): Promise<unknown> {
    this.platformAuthorization.assertPlatformAdmin(principal);
    const key = this.key(idempotencyKey);
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('Network trust reason is required');
    const verificationExpiresAt = this.expiry(input.status, input.verificationExpiresAt);
    const payloadHash = this.hash({ status: input.status, reason, method: input.method?.trim() || null, verificationExpiresAt: verificationExpiresAt?.toISOString() ?? null });
    const eventContext = currentEventContext() ?? createRequestContext();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.networkTrustCommandReceipt.findUnique({
          where: { organizationId_actorUserId_idempotencyKey: { organizationId, actorUserId: principal.userId, idempotencyKey: key } },
          select: { payloadHash: true, organizationId: true, verificationStatus: true, verifiedAt: true, verificationExpiresAt: true },
        });
        if (existing) {
          if (existing.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used with a different command');
          return this.serialize(existing);
        }

        const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
        if (!organization) throw new NotFoundException('Organization not found');
        await tx.organizationNetworkTrust.upsert({
          where: { organizationId },
          update: { verificationStatus: input.status, verifiedAt: input.status === 'VERIFIED' ? new Date() : null, verificationExpiresAt },
          create: { id: randomUUID(), organizationId, verificationStatus: input.status, verifiedAt: input.status === 'VERIFIED' ? new Date() : null, verificationExpiresAt },
        });
        const trust = await tx.organizationNetworkTrust.findUniqueOrThrow({ where: { organizationId }, select: { id: true, organizationId: true, verificationStatus: true, verifiedAt: true, verificationExpiresAt: true } });
        const receipt = await tx.networkTrustCommandReceipt.create({
          data: { id: randomUUID(), organizationId, actorUserId: principal.userId, idempotencyKey: key, payloadHash, verificationStatus: trust.verificationStatus, verifiedAt: trust.verifiedAt, verificationExpiresAt: trust.verificationExpiresAt, reason },
          select: { organizationId: true, verificationStatus: true, verifiedAt: true, verificationExpiresAt: true },
        });
        await tx.auditEvent.create({
          data: {
            id: randomUUID(),
            action: 'NETWORK_TRUST_CHANGED',
            actorUserId: principal.userId,
            organizationId,
            targetType: 'OrganizationNetworkTrust',
            targetId: trust.id,
            requestId: eventContext.requestId ?? null,
            correlationId: eventContext.correlationId,
            metadataJson: { status: trust.verificationStatus, reason, method: input.method?.trim() || null, verificationExpiresAt: trust.verificationExpiresAt?.toISOString() ?? null },
          },
        });
        await this.outbox.enqueue(tx, createDomainEvent({
          eventType: 'organization.verification_changed',
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          actor: { type: 'PLATFORM', id: principal.userId },
          aggregate: { type: 'OrganizationNetworkTrust', id: trust.id },
          organizationId,
          correlationId: eventContext.correlationId,
          ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}),
          dataClassification: 'RESTRICTED',
          purpose: 'network-trust-control-plane',
          payload: { status: trust.verificationStatus, reason, method: input.method?.trim() || null, verificationExpiresAt: trust.verificationExpiresAt?.toISOString() ?? null },
        }));
        return this.serialize({ ...receipt, verifiedAt: trust.verifiedAt });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const receipt = await this.prisma.networkTrustCommandReceipt.findUnique({ where: { organizationId_actorUserId_idempotencyKey: { organizationId, actorUserId: principal.userId, idempotencyKey: key } }, select: { payloadHash: true, organizationId: true, verificationStatus: true, verifiedAt: true, verificationExpiresAt: true } });
        if (receipt?.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used with a different command');
        if (receipt) return this.serialize(receipt);
      }
      throw error;
    }
  }

  private serialize(result: { organizationId: string; verificationStatus: NetworkVerificationStatus; verifiedAt?: Date | null; verificationExpiresAt: Date | null }): unknown {
    return { organizationId: result.organizationId, verificationStatus: result.verificationStatus, verifiedAt: result.verifiedAt?.toISOString() ?? null, verificationExpiresAt: result.verificationExpiresAt?.toISOString() ?? null };
  }

  private expiry(status: SetNetworkTrustCommandDto['status'], value?: string | null): Date | null {
    if (status === 'UNVERIFIED') {
      if (value) throw new BadRequestException('UNVERIFIED trust cannot have an expiry');
      return null;
    }
    const expiry = value ? new Date(value) : status === 'EXPIRED' ? new Date() : null;
    if (expiry && Number.isNaN(expiry.getTime())) throw new BadRequestException('Network trust expiry is invalid');
    if (status === 'VERIFIED' && expiry && expiry <= new Date()) throw new BadRequestException('VERIFIED trust expiry must be in the future');
    return expiry;
  }

  private key(value?: string): string {
    if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid');
    return value.trim();
  }

  private hash(value: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
