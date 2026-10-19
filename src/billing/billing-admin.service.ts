import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { PublishBillingPriceDto } from './billing.dto.js';

@Injectable()
export class BillingAdminService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: PrismaOutboxWriter) {}

  async publishPrice(principal: AuthPrincipal, input: PublishBillingPriceDto, rawIdempotencyKey?: string): Promise<unknown> {
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const currency = input.currency.trim().toUpperCase();
    if (currency !== 'USD') throw new BadRequestException('FairScale V1 billing prices must use USD');
    if (input.welcomeAmountMinor > input.baseAmountMinor) throw new BadRequestException('welcomeAmountMinor cannot exceed baseAmountMinor');
    if (input.annualDiscountAmountMinor > input.baseAmountMinor) throw new BadRequestException('annualDiscountAmountMinor cannot exceed baseAmountMinor');
    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('startsAt must be a valid date');
    const context = currentEventContext() ?? createRequestContext();

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.priceVersion.findUnique({ where: { idempotencyKey }, include: { components: true } });
      if (existing) {
        const component = existing.components.find((candidate) => candidate.code === 'ESTABLISHMENT');
        if (existing.planCode !== input.planCode || existing.billingPeriod !== input.billingPeriod || existing.baseAmountMinor !== BigInt(input.baseAmountMinor) || component?.amountMinor !== BigInt(input.addonAmountMinor)) throw new ConflictException('Idempotency-Key was already used for another price publication');
        return this.serialize(existing);
      }

      await tx.$queryRaw(Prisma.sql`SELECT code FROM plans WHERE code = ${input.planCode} FOR UPDATE`);
      const plan = await tx.plan.findUnique({ where: { code: input.planCode }, select: { code: true } });
      if (!plan) throw new NotFoundException('Billing plan not found');
      const latest = await tx.priceVersion.findFirst({ where: { planCode: input.planCode, billingPeriod: input.billingPeriod }, orderBy: { version: 'desc' }, select: { version: true } });
      const version = (latest?.version ?? 0) + 1;
      await tx.priceVersion.updateMany({ where: { planCode: input.planCode, billingPeriod: input.billingPeriod, status: 'ACTIVE', retiredAt: null }, data: { retiredAt: startsAt } });
      const price = await tx.priceVersion.create({
        data: {
          id: randomUUID(), planCode: input.planCode, version, billingPeriod: input.billingPeriod, currency, status: 'ACTIVE',
          baseAmountMinor: BigInt(input.baseAmountMinor), welcomeAmountMinor: BigInt(input.welcomeAmountMinor), annualDiscountAmountMinor: BigInt(input.annualDiscountAmountMinor), includedEstablishments: input.includedEstablishments,
          startsAt, publishedAt: new Date(), idempotencyKey,
          components: { create: { id: randomUUID(), code: 'ESTABLISHMENT', kind: 'ESTABLISHMENT_ADDON', currency, amountMinor: BigInt(input.addonAmountMinor), capacityUnits: input.addonCapacityUnits } },
        }, include: { components: true },
      });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'BILLING_PRICE_VERSION_PUBLISHED', actorUserId: principal.userId, organizationId: null, targetType: 'PriceVersion', targetId: price.id, requestId: context.requestId ?? null, correlationId: context.correlationId, metadataJson: { planCode: price.planCode, billingPeriod: price.billingPeriod, version, currency, startsAt: startsAt.toISOString() } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'billing.price.published', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'PLATFORM', id: principal.userId }, aggregate: { type: 'PriceVersion', id: price.id }, correlationId: context.correlationId, ...(context.requestId ? { requestId: context.requestId } : {}), dataClassification: 'INTERNAL', purpose: 'fairscale-billing-catalog', payload: { planCode: price.planCode, billingPeriod: price.billingPeriod, version, currency, startsAt: startsAt.toISOString() } }));
      return this.serialize(price);
    });
  }

  private requireIdempotencyKey(value?: string): string {
    if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid');
    return value.trim();
  }

  private serialize(price: { id: string; planCode: string; version: number; billingPeriod: string; currency: string; status: string; baseAmountMinor: bigint; welcomeAmountMinor: bigint; annualDiscountAmountMinor: bigint; includedEstablishments: number; startsAt: Date; publishedAt: Date | null; retiredAt: Date | null; components: Array<{ code: string; amountMinor: bigint; capacityUnits: number; currency: string }> }): unknown {
    return { id: price.id, planCode: price.planCode, version: price.version, billingPeriod: price.billingPeriod, currency: price.currency.trim(), status: price.status, baseAmountMinor: Number(price.baseAmountMinor), welcomeAmountMinor: Number(price.welcomeAmountMinor), annualDiscountAmountMinor: Number(price.annualDiscountAmountMinor), includedEstablishments: price.includedEstablishments, startsAt: price.startsAt.toISOString(), publishedAt: price.publishedAt?.toISOString() ?? null, retiredAt: price.retiredAt?.toISOString() ?? null, addons: price.components.map((component) => ({ code: component.code, amountMinor: Number(component.amountMinor), capacityUnits: component.capacityUnits, currency: component.currency.trim() })) };
  }
}
