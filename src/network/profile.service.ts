import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { UpdateOrganizationNetworkProfileDto } from './profile.dto.js';

@Injectable()
export class NetworkProfileService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async get(principal: AuthPrincipal, organizationId: string): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'NETWORK_PROFILE', 'network:profile:read');
    const organization = await this.prisma.organization.findFirst({ where: { id: organizationId, status: 'ACTIVE' }, select: { name: true } });
    if (!organization) throw new ForbiddenException('Organization access denied');
    const profile = await this.prisma.organizationNetworkProfile.upsert({
      where: { organizationId },
      update: {},
      create: { id: randomUUID(), organizationId, displayName: organization.name },
      select: this.privateSelect,
    });
    return this.serializePrivate(profile);
  }

  async update(principal: AuthPrincipal, organizationId: string, input: UpdateOrganizationNetworkProfileDto): Promise<unknown> {
    await this.authorization.requireModule(principal, organizationId, 'NETWORK_PROFILE', 'network:profile:write');
    if (Object.keys(input).length === 0) throw new BadRequestException('At least one profile field is required');
    const organization = await this.prisma.organization.findFirst({ where: { id: organizationId, status: 'ACTIVE' }, select: { name: true } });
    if (!organization) throw new ForbiddenException('Organization access denied');
    const eventContext = currentEventContext();
    const context = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();

    return this.prisma.$transaction(async (tx) => {
      await tx.organizationNetworkProfile.upsert({ where: { organizationId }, update: {}, create: { id: randomUUID(), organizationId, displayName: organization.name } });
      await tx.$queryRaw(Prisma.sql`SELECT id FROM organization_network_profiles WHERE organization_id = ${organizationId}::uuid FOR UPDATE`);
      const current = await tx.organizationNetworkProfile.findUniqueOrThrow({ where: { organizationId }, select: this.privateSelectWithPublishedAt });
      const nextPublic = input.isPublic ?? current.isPublic;
      const next = {
        isPublic: nextPublic,
        displayName: input.displayName?.trim() ?? current.displayName,
        description: input.description === undefined ? current.description : input.description?.trim() || null,
        categories: input.categories === undefined ? current.categories : input.categories.map((category) => category.trim()).filter(Boolean),
        publicLocation: input.publicLocation === undefined ? current.publicLocation : input.publicLocation?.trim() || null,
        publishedItemIds: input.publishedItemIds === undefined ? current.publishedItemIds : input.publishedItemIds,
        publishedAt: nextPublic ? current.publishedAt ?? new Date() : null,
      };
      if (JSON.stringify(next) === JSON.stringify({ isPublic: current.isPublic, displayName: current.displayName, description: current.description, categories: current.categories, publicLocation: current.publicLocation, publishedItemIds: current.publishedItemIds, publishedAt: current.publishedAt })) return this.serializePrivate(current);
      const updated = await tx.organizationNetworkProfile.update({ where: { organizationId }, data: { ...next, categories: next.categories as Prisma.InputJsonValue, publishedItemIds: next.publishedItemIds as Prisma.InputJsonValue }, select: this.privateSelectWithPublishedAt });
      const payload = { isPublic: updated.isPublic, displayName: updated.displayName, categories: updated.categories, publicLocation: updated.publicLocation };
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'NETWORK_PROFILE_UPDATED' satisfies AuditAction, actorUserId: principal.userId, organizationId, targetType: 'OrganizationNetworkProfile', targetId: updated.id, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'network.profile.updated', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'OrganizationNetworkProfile', id: updated.id }, organizationId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'network-profile', payload }));
      return this.serializePrivate(updated);
    });
  }

  async getPublic(organizationId: string): Promise<unknown> {
    const profile = await this.prisma.organizationNetworkProfile.findFirst({ where: { organizationId, isPublic: true, organization: { status: 'ACTIVE' } }, select: this.publicSelect });
    if (!profile) throw new NotFoundException('Public organization profile not found');
    return { organizationId: profile.organizationId, displayName: profile.displayName, description: profile.description, businessTypeCode: profile.organization.businessTypeCode, categories: this.jsonArray(profile.categories), publicLocation: profile.publicLocation, verified: false, publishedItemIds: this.jsonArray(profile.publishedItemIds), publishedAt: profile.publishedAt?.toISOString() ?? null };
  }

  private jsonArray(value: Prisma.JsonValue): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
  private serializePrivate(profile: { organizationId: string; isPublic: boolean; displayName: string; description: string | null; categories: Prisma.JsonValue; publicLocation: string | null; publishedItemIds: Prisma.JsonValue; updatedAt: Date }): unknown { return { organizationId: profile.organizationId, isPublic: profile.isPublic, displayName: profile.displayName, description: profile.description, categories: this.jsonArray(profile.categories), publicLocation: profile.publicLocation, publishedItemIds: this.jsonArray(profile.publishedItemIds), updatedAt: profile.updatedAt.toISOString() }; }

  private readonly privateSelect = { organizationId: true, isPublic: true, displayName: true, description: true, categories: true, publicLocation: true, publishedItemIds: true, updatedAt: true } as const;
  private readonly privateSelectWithPublishedAt = { ...this.privateSelect, id: true, publishedAt: true } as const;
  private readonly publicSelect = { organizationId: true, displayName: true, description: true, categories: true, publicLocation: true, publishedItemIds: true, publishedAt: true, organization: { select: { businessTypeCode: true } } } as const;
}
