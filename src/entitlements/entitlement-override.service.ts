import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';

export interface SetEntitlementOverrideInput {
  organizationId: string;
  moduleCode: string;
  effect: 'ALLOW' | 'DENY' | 'LIMIT_OVERRIDE';
  reason: string;
  startsAt?: Date;
  endsAt?: Date;
  limits?: Record<string, unknown>;
  actorId: string;
}

@Injectable()
export class EntitlementOverrideService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: PrismaOutboxWriter) {}

  async set(input: SetEntitlementOverrideInput): Promise<unknown> {
    const startsAt = input.startsAt ?? new Date();
    this.assertWindow(startsAt, input.endsAt);
    if (!input.reason.trim()) throw new BadRequestException('Entitlement override reason is required');
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(input.moduleCode)) throw new BadRequestException('Module code is invalid');
    if (input.effect === 'LIMIT_OVERRIDE' && (!input.limits || Object.keys(input.limits).length === 0)) {
      throw new BadRequestException('Limit override requires at least one limit');
    }
    if (input.limits && Object.entries(input.limits).some(([code, value]) => !/^[A-Z][A-Z0-9_]{1,79}$/.test(code) || !((typeof value === 'string' && /^\d+$/.test(value)) || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)))) {
      throw new BadRequestException('Limit override values must be non-negative integers');
    }
    const limitsJson = (input.limits ? JSON.parse(JSON.stringify(input.limits)) : {}) as Prisma.InputJsonValue;

    const eventContext = currentEventContext() ?? createRequestContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [organization, module] = await Promise.all([
          tx.organization.findUnique({ where: { id: input.organizationId }, select: { id: true, status: true } }),
          tx.moduleCatalog.findUnique({ where: { code: input.moduleCode }, select: { code: true, isCore: true } }),
        ]);
        if (!organization) throw new NotFoundException('Organization not found');
        if (!module) throw new NotFoundException('Module not found');
        if (module.isCore) throw new ConflictException('Core modules cannot receive commercial entitlement overrides');
        if (organization.status !== 'ACTIVE') throw new ConflictException('Organization is not active');

        const created = await tx.organizationEntitlement.create({
          data: {
            id: randomUUID(),
            organizationId: input.organizationId,
            moduleCode: input.moduleCode,
            effect: input.effect,
            startsAt,
            endsAt: input.endsAt ?? null,
            reason: input.reason.trim(),
            limitsJson,
            createdByActor: `PLATFORM:${input.actorId}`,
          },
          select: { id: true, organizationId: true, moduleCode: true, effect: true, startsAt: true, endsAt: true, reason: true, limitsJson: true, createdByActor: true, createdAt: true },
        });
        await tx.auditEvent.create({
          data: {
            id: randomUUID(),
            action: 'ENTITLEMENT_OVERRIDE_SET',
            actorUserId: input.actorId,
            organizationId: input.organizationId,
            targetType: 'OrganizationEntitlement',
            targetId: created.id,
            requestId: eventContext.requestId ?? null,
            correlationId: eventContext.correlationId,
            metadataJson: { moduleCode: input.moduleCode, effect: input.effect, reason: input.reason.trim(), startsAt: startsAt.toISOString(), endsAt: input.endsAt?.toISOString() ?? null, limits: limitsJson },
          },
        });
        await this.outbox.enqueue(tx, createDomainEvent({
          eventType: 'entitlement.override_set',
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          actor: { type: 'PLATFORM', id: input.actorId },
          aggregate: { type: 'OrganizationEntitlement', id: created.id },
          organizationId: input.organizationId,
          correlationId: eventContext.correlationId,
          ...(eventContext.requestId ? { requestId: eventContext.requestId } : {}),
          dataClassification: 'RESTRICTED',
          purpose: 'product-entitlements-control-plane',
          payload: { moduleCode: input.moduleCode, effect: input.effect, reason: input.reason.trim(), startsAt: startsAt.toISOString(), endsAt: input.endsAt?.toISOString() ?? null, limits: input.limits ?? {} },
        }));
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Equivalent entitlement override already exists');
      throw error;
    }
  }

  async list(organizationId: string): Promise<unknown[]> {
    return this.prisma.organizationEntitlement.findMany({ where: { organizationId }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }], select: { id: true, organizationId: true, moduleCode: true, effect: true, startsAt: true, endsAt: true, reason: true, limitsJson: true, createdByActor: true, createdAt: true } });
  }

  private assertWindow(startsAt: Date, endsAt?: Date): void {
    if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) throw new BadRequestException('Entitlement dates must be valid UTC dates');
    if (endsAt && endsAt <= startsAt) throw new BadRequestException('Entitlement end must be after its start');
  }
}
