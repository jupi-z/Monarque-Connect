import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { normalizeEmail } from '../auth/identity.js';
import { AuthorizationService } from './authorization.service.js';
import type { CreateInvitationDto } from './invitation.dto.js';
import { QuotaService } from '../entitlements/quota.service.js';

@Injectable()
export class InvitationService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter, private readonly quotas: QuotaService) {}

  async create(principal: AuthPrincipal, organizationId: string, input: CreateInvitationDto): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'memberships:write');
    const normalizedEmail = normalizeEmail(input.email);
    const token = randomBytes(32).toString('base64url');
    const invitationId = randomUUID();
    const eventContext = currentEventContext() ?? createRequestContext();
    const establishmentIds = input.scopeMode === 'SELECTED_ESTABLISHMENTS' ? Array.from(new Set(input.establishmentIds ?? [])) : [];
    if (input.scopeMode === 'SELECTED_ESTABLISHMENTS' && establishmentIds.length === 0) throw new ConflictException('Selected scope requires at least one establishment');
    try {
      const invitation = await this.prisma.$transaction(async (tx) => {
        if (establishmentIds.length > 0) {
          const count = await tx.establishment.count({ where: { organizationId, status: 'ACTIVE', id: { in: establishmentIds } } });
          if (count !== establishmentIds.length) throw new ForbiddenException('Establishment scope is invalid');
        }
        const created = await tx.invitation.create({ data: { id: invitationId, organizationId, email: input.email.trim(), normalizedEmail, role: input.role, scopeMode: input.scopeMode, tokenHash: this.hash(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), createdBy: principal.userId } });
        if (establishmentIds.length > 0) await tx.invitationEstablishmentScope.createMany({ data: establishmentIds.map((establishmentId) => ({ invitationId, establishmentId, organizationId })) });
        await tx.auditEvent.create({ data: { id: randomUUID(), action: 'INVITATION_CREATED', actorUserId: principal.userId, organizationId, targetType: 'Invitation', targetId: invitationId, requestId: eventContext.requestId ?? null, correlationId: eventContext.correlationId, metadataJson: { normalizedEmail, role: input.role, scopeMode: input.scopeMode } } });
        await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'membership.invitation.created', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Invitation', id: invitationId }, organizationId, correlationId: eventContext.correlationId, ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'identity-tenancy-audit', payload: { role: input.role, scopeMode: input.scopeMode } }));
        return created;
      });
      return { id: invitation.id, organizationId, email: invitation.email, role: invitation.role, scopeMode: invitation.scopeMode, expiresAt: invitation.expiresAt, token };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('An active invitation already exists');
      throw error;
    }
  }

  async accept(principal: AuthPrincipal, token: string): Promise<unknown> {
    const eventContext = currentEventContext() ?? createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({ where: { tokenHash: this.hash(token) }, include: { scopeLinks: true } });
      const user = await tx.user.findUnique({ where: { id: principal.userId }, select: { normalizedEmail: true, status: true } });
      if (!invitation || !user || user.status !== 'ACTIVE' || invitation.normalizedEmail !== user.normalizedEmail) throw new NotFoundException('Invitation not found');
      if (invitation.status !== 'PENDING' || invitation.expiresAt <= new Date()) {
        if (invitation.status === 'PENDING') await tx.invitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });
        throw new ConflictException('Invitation is no longer valid');
      }
      const existing = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: invitation.organizationId, userId: principal.userId } } });
      if (existing) throw new ConflictException('User already has a membership in this organization');
      const membershipId = randomUUID();
      await this.quotas.consume(tx, { organizationId: invitation.organizationId, quotaCode: 'MAX_USERS', amount: 1n, idempotencyKey: `organization:${invitation.organizationId}:membership:${membershipId}`, resourceType: 'Membership', resourceId: membershipId });
      await tx.membership.create({ data: { id: membershipId, organizationId: invitation.organizationId, userId: principal.userId, role: invitation.role, scopeMode: invitation.scopeMode } });
      if (invitation.scopeMode === 'SELECTED_ESTABLISHMENTS') await tx.membershipEstablishmentScope.createMany({ data: invitation.scopeLinks.map((scope) => ({ membershipId, establishmentId: scope.establishmentId, organizationId: invitation.organizationId })) });
      await tx.invitation.update({ where: { id: invitation.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'INVITATION_ACCEPTED', actorUserId: principal.userId, organizationId: invitation.organizationId, targetType: 'Invitation', targetId: invitation.id, requestId: eventContext.requestId ?? null, correlationId: eventContext.correlationId, metadataJson: { membershipId } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'membership.invitation.accepted', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Membership', id: membershipId }, organizationId: invitation.organizationId, correlationId: eventContext.correlationId, ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'identity-tenancy-audit', payload: { membershipId, invitationId: invitation.id } }));
      return { organizationId: invitation.organizationId, membershipId, role: invitation.role, scopeMode: invitation.scopeMode };
    });
  }

  private hash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
}
