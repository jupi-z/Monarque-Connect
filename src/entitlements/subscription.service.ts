import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';

type LifecycleStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'EXPIRED' | 'CANCELED';
const effectiveStatuses: LifecycleStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE'];
const transitions: Record<LifecycleStatus, readonly LifecycleStatus[]> = {
  TRIALING: ['ACTIVE', 'PAST_DUE', 'SUSPENDED', 'EXPIRED', 'CANCELED'],
  ACTIVE: ['PAST_DUE', 'SUSPENDED', 'EXPIRED', 'CANCELED'],
  PAST_DUE: ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELED'],
  SUSPENDED: ['ACTIVE', 'EXPIRED', 'CANCELED'],
  EXPIRED: [],
  CANCELED: [],
};

export interface CreateSubscriptionInput {
  organizationId: string;
  planVersionId: string;
  startsAt: Date;
  endsAt?: Date;
  status?: 'TRIALING' | 'ACTIVE';
}

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: PrismaOutboxWriter) {}

  async create(input: CreateSubscriptionInput): Promise<{ id: string; status: LifecycleStatus; startsAt: Date; endsAt: Date | null }> {
    const status = input.status ?? 'ACTIVE';
    this.assertDateWindow(input.startsAt, input.endsAt);
    const context = currentEventContext() ?? createRequestContext();
    const id = randomUUID();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const [organization, planVersion] = await Promise.all([
          tx.organization.findUnique({ where: { id: input.organizationId }, select: { id: true, status: true } }),
          tx.planVersion.findUnique({ where: { id: input.planVersionId }, select: { id: true, status: true, planCode: true, version: true } }),
        ]);
        if (!organization || organization.status !== 'ACTIVE') throw new ConflictException('Organization is not active');
        if (!planVersion || planVersion.status !== 'ACTIVE') throw new ConflictException('Plan version is not active');

        const overlap = await tx.subscription.findFirst({
          where: {
            organizationId: input.organizationId,
            status: { in: effectiveStatuses },
            startsAt: { lt: input.endsAt ?? new Date('9999-12-31T23:59:59.999Z') },
            OR: [{ endsAt: null }, { endsAt: { gt: input.startsAt } }],
          },
          select: { id: true },
        });
        if (overlap) throw new ConflictException('Organization already has an overlapping effective subscription');

        const subscription = await tx.subscription.create({
          data: { id, organizationId: input.organizationId, planVersionId: input.planVersionId, status, startsAt: input.startsAt, endsAt: input.endsAt ?? null },
          select: { id: true, status: true, startsAt: true, endsAt: true },
        });
        await tx.auditEvent.create({
          data: { id: randomUUID(), action: 'SUBSCRIPTION_CREATED', organizationId: input.organizationId, targetType: 'Subscription', targetId: id, requestId: context.requestId ?? null, correlationId: context.correlationId, metadataJson: { planCode: planVersion.planCode, planVersion: planVersion.version, status, startsAt: input.startsAt.toISOString(), endsAt: input.endsAt?.toISOString() ?? null } },
        });
        await this.outbox.enqueue(tx, createDomainEvent({
          eventType: 'subscription.created', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'SYSTEM' }, aggregate: { type: 'Subscription', id }, organizationId: input.organizationId, correlationId: context.correlationId, ...(context.requestId ? { requestId: context.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'product-entitlements-lifecycle', payload: { planCode: planVersion.planCode, planVersion: planVersion.version, status, startsAt: input.startsAt.toISOString(), endsAt: input.endsAt?.toISOString() ?? null },
        }));
        return subscription;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Organization already has an open subscription');
      throw error;
    }
  }

  async resolveEffective(organizationId: string, at: Date): Promise<{ id: string; status: LifecycleStatus; startsAt: Date; endsAt: Date | null; planVersionId: string } | null> {
    return this.prisma.subscription.findFirst({
      where: { organizationId, organization: { status: 'ACTIVE' }, status: { in: effectiveStatuses }, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, status: true, startsAt: true, endsAt: true, planVersionId: true },
    });
  }

  async transition(id: string, nextStatus: LifecycleStatus, effectiveAt: Date, reason: string): Promise<{ id: string; status: LifecycleStatus; canceledAt: Date | null; endsAt: Date | null }> {
    if (!reason.trim()) throw new BadRequestException('Transition reason is required');
    const context = currentEventContext() ?? createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.subscription.findUnique({ where: { id }, select: { id: true, organizationId: true, status: true, endsAt: true, canceledAt: true } });
      if (!current) throw new NotFoundException();
      if (current.status === nextStatus) return current;
      if (!transitions[current.status].includes(nextStatus)) throw new ConflictException(`Subscription cannot transition from ${current.status} to ${nextStatus}`);

      const nextEndsAt = nextStatus === 'EXPIRED' && !current.endsAt ? effectiveAt : current.endsAt;
      const nextCanceledAt = nextStatus === 'CANCELED' ? effectiveAt : current.canceledAt;
      const updated = await tx.subscription.update({ where: { id }, data: { status: nextStatus, endsAt: nextEndsAt, canceledAt: nextCanceledAt }, select: { id: true, status: true, canceledAt: true, endsAt: true } });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'SUBSCRIPTION_TRANSITIONED', organizationId: current.organizationId, targetType: 'Subscription', targetId: id, requestId: context.requestId ?? null, correlationId: context.correlationId, metadataJson: { from: current.status, to: nextStatus, effectiveAt: effectiveAt.toISOString(), reason } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'subscription.transitioned', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'SYSTEM' }, aggregate: { type: 'Subscription', id }, organizationId: current.organizationId, correlationId: context.correlationId, ...(context.requestId ? { requestId: context.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'product-entitlements-lifecycle', payload: { from: current.status, to: nextStatus, effectiveAt: effectiveAt.toISOString(), reason } }));
      return updated;
    });
  }

  private assertDateWindow(startsAt: Date, endsAt?: Date): void {
    if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) throw new BadRequestException('Subscription dates must be valid UTC dates');
    if (endsAt && endsAt <= startsAt) throw new BadRequestException('Subscription end must be after its start');
  }
}
