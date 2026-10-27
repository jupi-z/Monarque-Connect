import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { LinkBillingCustomerOrganizationDto, PublishBillingPriceDto, SetBillingCustomerVerificationDto } from './billing.dto.js';

const LEGACY_PRODUCT_CODE = 'MONARQUE_CONNECT' as const;

@Injectable()
export class BillingAdminService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: PrismaOutboxWriter) {}

  async publishPrice(principal: AuthPrincipal, input: PublishBillingPriceDto, rawIdempotencyKey?: string): Promise<unknown> {
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const currency = input.currency.trim().toUpperCase();
    if (currency !== 'USD') throw new BadRequestException('FairScale V1 billing prices must use USD');
    if (input.welcomeAmountMinor > input.baseAmountMinor) throw new BadRequestException('welcomeAmountMinor cannot exceed baseAmountMinor');
    if (input.annualDiscountAmountMinor > input.baseAmountMinor) throw new BadRequestException('annualDiscountAmountMinor cannot exceed baseAmountMinor');
    const requestedStartsAt = input.startsAt ? new Date(input.startsAt) : null;
    const startsAt = requestedStartsAt ?? new Date();
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('startsAt must be a valid date');
    const context = currentEventContext() ?? createRequestContext();

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.priceVersion.findUnique({ where: { idempotencyKey }, include: { components: true } });
      if (existing) {
        const component = existing.components.find((candidate) => candidate.code === 'ESTABLISHMENT');
        if (
          existing.planCode !== input.planCode ||
          existing.billingPeriod !== input.billingPeriod ||
          existing.currency.trim() !== currency ||
          existing.baseAmountMinor !== BigInt(input.baseAmountMinor) ||
          existing.welcomeAmountMinor !== BigInt(input.welcomeAmountMinor) ||
          existing.annualDiscountAmountMinor !== BigInt(input.annualDiscountAmountMinor) ||
          existing.includedEstablishments !== input.includedEstablishments ||
          component?.amountMinor !== BigInt(input.addonAmountMinor) ||
          component?.capacityUnits !== input.addonCapacityUnits ||
          (requestedStartsAt && existing.startsAt.getTime() !== requestedStartsAt.getTime())
        ) throw new ConflictException('Idempotency-Key was already used for another price publication');
        return this.serialize(existing);
      }

      await tx.$queryRaw(Prisma.sql`SELECT code FROM plans WHERE code = ${input.planCode} FOR UPDATE`);
      const plan = await tx.plan.findUnique({ where: { code: input.planCode }, select: { code: true } });
      if (!plan) throw new NotFoundException('Billing plan not found');
      const latest = await tx.priceVersion.findFirst({ where: { productCode: LEGACY_PRODUCT_CODE, planCode: input.planCode, billingPeriod: input.billingPeriod }, orderBy: { version: 'desc' }, select: { version: true } });
      const version = (latest?.version ?? 0) + 1;
      await tx.priceVersion.updateMany({ where: { productCode: LEGACY_PRODUCT_CODE, planCode: input.planCode, billingPeriod: input.billingPeriod, status: 'ACTIVE', retiredAt: null }, data: { retiredAt: startsAt } });
      const price = await tx.priceVersion.create({
        data: {
          id: randomUUID(), productCode: LEGACY_PRODUCT_CODE, planCode: input.planCode, version, billingPeriod: input.billingPeriod, currency, status: 'ACTIVE',
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

  async setCustomerVerification(principal: AuthPrincipal, customerId: string, input: SetBillingCustomerVerificationDto, rawIdempotencyKey?: string): Promise<unknown> {
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('reason is required');
    const payloadHash = createHash('sha256').update(JSON.stringify({ status: input.status, reason })).digest('hex');
    const context = currentEventContext() ?? createRequestContext();

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.billingCustomerVerificationReceipt.findUnique({ where: { billingCustomerId_actorUserId_idempotencyKey: { billingCustomerId: customerId, actorUserId: principal.userId, idempotencyKey } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used for another verification decision');
        return tx.billingCustomer.findUniqueOrThrow({ where: { id: customerId }, select: { id: true, status: true, verifiedAt: true } }).then((customer) => this.serializeCustomerVerification(customer));
      }
      await tx.$queryRaw(Prisma.sql`SELECT id FROM billing_customers WHERE id = ${customerId}::uuid FOR UPDATE`);
      const customer = await tx.billingCustomer.findUnique({ where: { id: customerId }, select: { id: true, status: true, verifiedAt: true } });
      if (!customer) throw new NotFoundException('Billing customer not found');
      const verifiedAt = input.status === 'VERIFIED' ? new Date() : null;
      const updated = await tx.billingCustomer.update({ where: { id: customerId }, data: { status: input.status, verifiedAt } , select: { id: true, status: true, verifiedAt: true } });
      await tx.billingCustomerVerificationReceipt.create({ data: { id: randomUUID(), billingCustomerId: customerId, actorUserId: principal.userId, idempotencyKey, payloadHash, verificationStatus: input.status, reason } });
      await tx.auditEvent.create({ data: { id: randomUUID(), action: 'BILLING_CUSTOMER_VERIFICATION_CHANGED', actorUserId: principal.userId, organizationId: null, targetType: 'BillingCustomer', targetId: customerId, requestId: context.requestId ?? null, correlationId: context.correlationId, metadataJson: { before: customer.status, after: updated.status, reason } } });
      await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'billing.customer.verification_changed', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'PLATFORM', id: principal.userId }, aggregate: { type: 'BillingCustomer', id: customerId }, correlationId: context.correlationId, ...(context.requestId ? { requestId: context.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'fairscale-billing-verification', payload: { status: updated.status } }));
      return this.serializeCustomerVerification(updated);
    });
  }

  async linkOrganization(principal: AuthPrincipal, customerId: string, organizationId: string, input: LinkBillingCustomerOrganizationDto): Promise<unknown> {
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('reason is required');
    const context = currentEventContext() ?? createRequestContext();

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM billing_customers WHERE id = ${customerId}::uuid FOR UPDATE`);
      const customer = await tx.billingCustomer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!customer) throw new NotFoundException('Billing customer not found');
      const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
      if (!organization) throw new NotFoundException('Organization not found');
      const existing = await tx.billingCustomerOrganization.findFirst({ where: { organizationId }, select: { billingCustomerId: true, role: true, evidenceJson: true } });
      if (existing && existing.billingCustomerId !== customerId) throw new ConflictException('Organization is already linked to another BillingCustomer');
      const link = existing ?? await tx.billingCustomerOrganization.create({ data: { billingCustomerId: customerId, organizationId, role: 'OWNER', evidenceJson: { source: 'platform-billing-link', reason } } });
      if (!existing) {
        await tx.auditEvent.create({ data: { id: randomUUID(), action: 'BILLING_CUSTOMER_ORGANIZATION_LINKED', actorUserId: principal.userId, organizationId, targetType: 'BillingCustomerOrganization', targetId: customerId, requestId: context.requestId ?? null, correlationId: context.correlationId, metadataJson: { organizationId, reason } } });
        await this.outbox.enqueue(tx, createDomainEvent({ eventType: 'billing.customer.organization_linked', eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'PLATFORM', id: principal.userId }, aggregate: { type: 'BillingCustomer', id: customerId }, organizationId, correlationId: context.correlationId, ...(context.requestId ? { requestId: context.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'fairscale-billing-identity', payload: { organizationId } }));
      }
      return { billingCustomerId: link.billingCustomerId, organizationId, role: link.role, evidence: link.evidenceJson };
    });
  }

  private requireIdempotencyKey(value?: string): string {
    if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid');
    return value.trim();
  }

  private serializeCustomerVerification(customer: { id: string; status: string; verifiedAt: Date | null }): unknown {
    return { id: customer.id, status: customer.status, verifiedAt: customer.verifiedAt?.toISOString() ?? null };
  }

  private serialize(price: { id: string; planCode: string; version: number; billingPeriod: string; currency: string; status: string; baseAmountMinor: bigint; welcomeAmountMinor: bigint; annualDiscountAmountMinor: bigint; includedEstablishments: number; startsAt: Date; publishedAt: Date | null; retiredAt: Date | null; components: Array<{ code: string; amountMinor: bigint; capacityUnits: number; currency: string }> }): unknown {
    return { id: price.id, planCode: price.planCode, version: price.version, billingPeriod: price.billingPeriod, currency: price.currency.trim(), status: price.status, baseAmountMinor: Number(price.baseAmountMinor), welcomeAmountMinor: Number(price.welcomeAmountMinor), annualDiscountAmountMinor: Number(price.annualDiscountAmountMinor), includedEstablishments: price.includedEstablishments, startsAt: price.startsAt.toISOString(), publishedAt: price.publishedAt?.toISOString() ?? null, retiredAt: price.retiredAt?.toISOString() ?? null, addons: price.components.map((component) => ({ code: component.code, amountMinor: Number(component.amountMinor), capacityUnits: component.capacityUnits, currency: component.currency.trim() })) };
  }
}
