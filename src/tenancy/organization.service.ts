import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import type { AuthPrincipal, AuthorizationContext } from '../auth/auth.types.js';
import { AuthorizationService } from './authorization.service.js';
import type { CreateEstablishmentDto, CreateOrganizationDto, UpdateEstablishmentDto, UpdateOrganizationDto } from './organization.dto.js';
import type { UpdateMembershipDto } from './membership.dto.js';
import { EffectiveEntitlementsService } from '../entitlements/effective-entitlements.service.js';
import { QuotaService } from '../entitlements/quota.service.js';
import { SubscriptionService } from '../entitlements/subscription.service.js';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly outbox: PrismaOutboxWriter,
    private readonly entitlements: EffectiveEntitlementsService,
    private readonly quotasService: QuotaService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  async create(principal: AuthPrincipal, input: CreateOrganizationDto): Promise<unknown> {
    const organizationId = randomUUID();
    const establishmentId = randomUUID();
    const membershipId = randomUUID();
    const context = currentEventContext() ?? createRequestContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({ data: {
          id: organizationId, businessTypeCode: input.businessTypeCode, name: input.name.trim(),
          ...(input.legalName ? { legalName: input.legalName.trim() } : {}), handle: input.handle,
          defaultCurrency: input.defaultCurrency,
        } });
        const planCode = 'CONNECT';
        const planVersion = await tx.planVersion.findUnique({ where: { planCode_version: { planCode, version: 1 } }, select: { id: true } });
        if (!planVersion) throw new ConflictException('Requested plan is not available');
        await this.subscriptions.createInTransaction(tx, { organizationId, planVersionId: planVersion.id, startsAt: organization.createdAt, status: 'ACTIVE' }, context);
        const establishment = await tx.establishment.create({ data: {
          id: establishmentId, organizationId, code: input.establishmentCode ?? 'HEAD-OFFICE',
          name: input.establishmentName.trim(), type: input.establishmentType ?? 'HEAD_OFFICE', isPrimary: true,
        } });
        await tx.membership.create({ data: { id: membershipId, organizationId, userId: principal.userId, role: 'OWNER', scopeMode: 'ALL_ESTABLISHMENTS' } });
        await this.quotasService.consume(tx, { organizationId, quotaCode: 'MAX_ESTABLISHMENTS', amount: 1n, idempotencyKey: `organization:${organizationId}:establishment:${establishmentId}`, resourceType: 'Establishment', resourceId: establishmentId, at: organization.createdAt });
        await this.quotasService.consume(tx, { organizationId, quotaCode: 'MAX_USERS', amount: 1n, idempotencyKey: `organization:${organizationId}:membership:${membershipId}`, resourceType: 'Membership', resourceId: membershipId, at: organization.createdAt });
        await tx.auditEvent.create({ data: {
          id: randomUUID(), action: 'ORGANIZATION_CREATED', actorUserId: principal.userId, organizationId,
          targetType: 'Organization', targetId: organizationId, requestId: context.requestId ?? null,
          correlationId: context.correlationId, metadataJson: { businessTypeCode: input.businessTypeCode, planCode },
        } });
        await this.outbox.enqueue(tx, createDomainEvent({
          eventType: 'organization.created', eventVersion: 1, occurredAt: new Date().toISOString(),
          actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Organization', id: organizationId },
          organizationId, correlationId: context.correlationId, ...(context.requestId ? { requestId: context.requestId } : {}),
          dataClassification: 'CONFIDENTIAL', purpose: 'identity-tenancy-audit',
          payload: { businessTypeCode: input.businessTypeCode, establishmentId, planCode },
        }));
        return { id: organization.id, name: organization.name, handle: organization.handle, defaultCurrency: organization.defaultCurrency, planCode, establishment };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2003')) {
        if (process.env.NODE_ENV === 'test') {
          console.error(`[organization-create-test-diagnostic] ${JSON.stringify({
            prismaCode: error.code,
            modelName: error.meta?.modelName ?? null,
            target: error.meta?.target ?? null,
            fieldName: error.meta?.field_name ?? null,
            constraint: error.meta?.constraint ?? null,
          })}`);
        }
        throw new ConflictException('Organization data conflicts with an existing record');
      }
      throw error;
    }
  }

  async list(principal: AuthPrincipal): Promise<unknown[]> {
    return this.prisma.organization.findMany({
      where: { status: 'ACTIVE', memberships: { some: { userId: principal.userId, status: 'ACTIVE' } } },
      orderBy: { name: 'asc' }, select: { id: true, name: true, handle: true, defaultCurrency: true, businessTypeCode: true, status: true },
    });
  }

  async get(principal: AuthPrincipal, organizationId: string): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'organization:read');
    const organization = await this.prisma.organization.findFirst({ where: { id: organizationId, status: 'ACTIVE' }, select: { id: true, name: true, legalName: true, handle: true, defaultCurrency: true, businessTypeCode: true, status: true } });
    if (!organization) throw new NotFoundException();
    return { ...organization, role: context.role, scopeMode: context.scopeMode };
  }

  async update(principal: AuthPrincipal, organizationId: string, input: UpdateOrganizationDto): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'organization:write');
    const eventContext = currentEventContext() ?? createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.update({ where: { id: organizationId }, data: { ...(input.name ? { name: input.name.trim() } : {}), ...(input.legalName !== undefined ? { legalName: input.legalName.trim() } : {}) }, select: { id: true, name: true, legalName: true, handle: true, defaultCurrency: true, businessTypeCode: true, status: true } });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'ORGANIZATION_UPDATED', actorUserId: principal.userId, organizationId, targetType: 'Organization', targetId: organizationId, requestId: eventContext.requestId ?? null, correlationId: eventContext.correlationId, metadataJson: { fields: Object.keys(input) } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'organization.updated', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Organization', id: organizationId }, organizationId, correlationId: eventContext.correlationId, ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'identity-tenancy-audit', payload: { fields: Object.keys(input) } }));
      return { ...organization, role: context.role, scopeMode: context.scopeMode };
    });
  }

  async establishments(principal: AuthPrincipal, organizationId: string): Promise<unknown[]> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'establishments:read');
    return this.prisma.establishment.findMany({
      where: { organizationId, status: 'ACTIVE', ...(context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? { id: { in: Array.from(context.establishmentIds) } } : {}) },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }], select: { id: true, code: true, name: true, type: true, isPrimary: true, status: true },
    });
  }

  async createEstablishment(principal: AuthPrincipal, organizationId: string, input: CreateEstablishmentDto): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'establishments:write');
    const establishmentId = randomUUID();
    const eventContext = currentEventContext() ?? createRequestContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.quotasService.consume(tx, { organizationId, quotaCode: 'MAX_ESTABLISHMENTS', amount: 1n, idempotencyKey: `organization:${organizationId}:establishment:${establishmentId}`, resourceType: 'Establishment', resourceId: establishmentId });
        const establishment = await tx.establishment.create({ data: { id: establishmentId, organizationId, code: input.code, name: input.name.trim(), type: input.type } });
        await tx.auditEvent.create({ data: { id: randomUUID(), action: 'ESTABLISHMENT_CREATED', actorUserId: principal.userId, organizationId, establishmentId, targetType: 'Establishment', targetId: establishmentId, requestId: eventContext.requestId ?? null, correlationId: eventContext.correlationId, metadataJson: { code: input.code, type: input.type } } });
        await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'establishment.created', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Establishment', id: establishmentId }, organizationId, establishmentId, correlationId: eventContext.correlationId, ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'identity-tenancy-audit', payload: { code: input.code, type: input.type } }));
        return { id: establishment.id, code: establishment.code, name: establishment.name, type: establishment.type, isPrimary: establishment.isPrimary, status: establishment.status };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Establishment code already exists in this organization');
      throw error;
    }
  }

  async getEstablishment(principal: AuthPrincipal, organizationId: string, establishmentId: string): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'establishments:read');
    await this.authorization.assertEstablishment(context, establishmentId);
    const establishment = await this.prisma.establishment.findFirst({ where: { id: establishmentId, organizationId, status: 'ACTIVE' }, select: { id: true, code: true, name: true, type: true, isPrimary: true, status: true } });
    if (!establishment) throw new NotFoundException();
    return establishment;
  }

  async updateEstablishment(principal: AuthPrincipal, organizationId: string, establishmentId: string, input: UpdateEstablishmentDto): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'establishments:write');
    await this.authorization.assertEstablishment(context, establishmentId);
    const eventContext = currentEventContext() ?? createRequestContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const establishment = await tx.establishment.update({ where: { id: establishmentId, organizationId }, data: { ...(input.name ? { name: input.name.trim() } : {}), ...(input.type ? { type: input.type } : {}) }, select: { id: true, code: true, name: true, type: true, isPrimary: true, status: true } });
        await tx.auditEvent.create({ data: { id: randomUUID(), action: 'ESTABLISHMENT_UPDATED', actorUserId: principal.userId, organizationId, establishmentId, targetType: 'Establishment', targetId: establishmentId, requestId: eventContext.requestId ?? null, correlationId: eventContext.correlationId, metadataJson: { fields: Object.keys(input) } } });
        await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'establishment.updated', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Establishment', id: establishmentId }, organizationId, establishmentId, correlationId: eventContext.correlationId, ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'identity-tenancy-audit', payload: { fields: Object.keys(input) } }));
        return establishment;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new NotFoundException();
      throw error;
    }
  }

  async members(principal: AuthPrincipal, organizationId: string): Promise<unknown[]> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'organization:read');
    return this.prisma.membership.findMany({ where: { organizationId, status: { in: ['ACTIVE', 'INVITED'] } }, orderBy: { createdAt: 'asc' }, select: { id: true, role: true, scopeMode: true, status: true, user: { select: { id: true, email: true, firstName: true, lastName: true } }, scopeLinks: { select: { establishmentId: true } } } });
  }

  async updateMember(principal: AuthPrincipal, organizationId: string, membershipId: string, input: UpdateMembershipDto): Promise<unknown> {
    const actor = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(actor, 'memberships:write');
    const target = await this.prisma.membership.findFirst({ where: { id: membershipId, organizationId }, include: { scopeLinks: { select: { establishmentId: true } } } });
    if (!target) throw new NotFoundException();
    const nextRole = input.role ?? target.role;
    const nextStatus = input.status ?? target.status;
    const nextScopeMode = input.scopeMode ?? target.scopeMode;
    if (target.role === 'OWNER' && (nextRole !== 'OWNER' || nextStatus !== 'ACTIVE')) {
      const ownerCount = await this.prisma.membership.count({ where: { organizationId, role: 'OWNER', status: 'ACTIVE' } });
      if (ownerCount <= 1) throw new ConflictException('The last active owner cannot be removed');
    }
    const establishmentIds = nextScopeMode === 'SELECTED_ESTABLISHMENTS'
      ? Array.from(new Set(input.establishmentIds ?? target.scopeLinks.map((scope) => scope.establishmentId)))
      : [];
    if (nextScopeMode === 'SELECTED_ESTABLISHMENTS' && establishmentIds.length === 0) throw new ConflictException('Selected scope requires at least one establishment');
    const eventContext = currentEventContext() ?? createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      if (establishmentIds.length > 0) {
        const count = await tx.establishment.count({ where: { organizationId, status: 'ACTIVE', id: { in: establishmentIds } } });
        if (count !== establishmentIds.length) throw new ForbiddenException('Establishment scope is invalid');
      }
      const membership = await tx.membership.update({ where: { id: membershipId }, data: { role: nextRole, status: nextStatus, scopeMode: nextScopeMode } });
      await tx.membershipEstablishmentScope.deleteMany({ where: { membershipId } });
      if (establishmentIds.length > 0) await tx.membershipEstablishmentScope.createMany({ data: establishmentIds.map((establishmentId) => ({ membershipId, establishmentId, organizationId })) });
      if (target.status === 'ACTIVE' && nextStatus !== 'ACTIVE') {
        await this.quotasService.reconcileCapacity(tx, { organizationId, quotaCode: 'MAX_USERS', amount: 1n, direction: 'DECREASE', idempotencyKey: `organization:${organizationId}:membership:${membershipId}:status:${target.status}:${nextStatus}:${target.updatedAt.toISOString()}`, resourceType: 'Membership', resourceId: membershipId });
      } else if (target.status !== 'ACTIVE' && nextStatus === 'ACTIVE') {
        await this.quotasService.reconcileCapacity(tx, { organizationId, quotaCode: 'MAX_USERS', amount: 1n, direction: 'INCREASE', idempotencyKey: `organization:${organizationId}:membership:${membershipId}:status:${target.status}:${nextStatus}:${target.updatedAt.toISOString()}`, resourceType: 'Membership', resourceId: membershipId });
      }
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'MEMBERSHIP_UPDATED', actorUserId: principal.userId, organizationId, targetType: 'Membership', targetId: membershipId, requestId: eventContext.requestId ?? null, correlationId: eventContext.correlationId, metadataJson: { role: nextRole, status: nextStatus, scopeMode: nextScopeMode } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'membership.updated', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Membership', id: membershipId }, organizationId, correlationId: eventContext.correlationId, ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'identity-tenancy-audit', payload: { role: nextRole, status: nextStatus, scopeMode: nextScopeMode } }));
      return { id: membership.id, role: membership.role, status: membership.status, scopeMode: membership.scopeMode, establishmentIds };
    });
  }

  async capabilities(principal: AuthPrincipal, organizationId: string, activeEstablishmentId?: string): Promise<unknown> {
    const context: AuthorizationContext = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'capabilities:read');
    if (activeEstablishmentId) await this.authorization.assertEstablishment(context, activeEstablishmentId);
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { businessTypeCode: true, defaultCurrency: true } });
    const establishments = await this.establishments(principal, organizationId);
    const effective = await this.entitlements.resolve(organizationId);
    return { ...effective, businessTypeCode: organization.businessTypeCode, defaultCurrency: organization.defaultCurrency, role: context.role, scopeMode: context.scopeMode, activeEstablishmentId: activeEstablishmentId ?? null, establishments, permissions: this.permissions(context) };
  }

  async modules(principal: AuthPrincipal, organizationId: string): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'capabilities:read');
    return (await this.entitlements.resolve(organizationId)).modules;
  }

  async quotas(principal: AuthPrincipal, organizationId: string): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'capabilities:read');
    return this.quotasService.list(organizationId);
  }

  async updateModuleActivation(principal: AuthPrincipal, organizationId: string, moduleCode: string, enabled: boolean, reason: string): Promise<unknown> {
    const context = await this.authorization.requireMembership(principal, organizationId);
    this.authorization.assertPermission(context, 'organization:write');
    if (!reason.trim()) throw new BadRequestException('Activation reason is required');
    const module = await this.prisma.moduleCatalog.findUnique({ where: { code: moduleCode }, select: { code: true, isCore: true } });
    if (!module) throw new NotFoundException();
    if (module.isCore) throw new BadRequestException('Core modules cannot be activated or deactivated');
    const projection = await this.entitlements.resolve(organizationId);
    const target = projection.modules.find((item) => item.code === moduleCode);
    if (!target) throw new NotFoundException();
    if (enabled && (!target.entitled || target.reason === 'MODULE_NOT_INCLUDED' || target.reason === 'NO_ACTIVE_SUBSCRIPTION' || target.reason === 'SUBSCRIPTION_INACTIVE' || target.reason === 'MODULE_RETIRED' || target.reason === 'DEPENDENCY_NOT_ENTITLED')) {
      throw new ForbiddenException('Module entitlement or dependencies are not active');
    }
    const eventContext = currentEventContext() ?? createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.organizationModuleActivation.findUnique({ where: { organizationId_moduleCode: { organizationId, moduleCode } }, select: { enabled: true } });
      const previousEnabled = current?.enabled ?? target.active;
      if (previousEnabled === enabled) return { moduleCode, enabled, changed: false };
      const activation = await tx.organizationModuleActivation.upsert({
        where: { organizationId_moduleCode: { organizationId, moduleCode } },
        update: { enabled },
        create: { id: randomUUID(), organizationId, moduleCode, enabled },
        select: { id: true },
      });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'MODULE_ACTIVATION_CHANGED', actorUserId: principal.userId, organizationId, targetType: 'OrganizationModuleActivation', targetId: activation.id, requestId: eventContext.requestId ?? null, correlationId: eventContext.correlationId, metadataJson: { moduleCode, previousEnabled, enabled, reason } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'module.activation_changed', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Organization', id: organizationId }, organizationId, correlationId: eventContext.correlationId, ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'product-entitlements-module-activation', payload: { moduleCode, previousEnabled, enabled, reason } }));
      return { moduleCode, enabled, changed: true };
    });
  }

  private permissions(context: AuthorizationContext): string[] {
    return ['organization:read', 'establishments:read', 'capabilities:read', ...(this.authorization.can(context, 'organization:write') ? ['organization:write'] : []), ...(this.authorization.can(context, 'establishments:write') ? ['establishments:write'] : []), ...(this.authorization.can(context, 'memberships:write') ? ['memberships:write'] : [])];
  }
}
