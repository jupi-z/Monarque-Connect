import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { PlatformAuthorizationService } from '../entitlements/platform-authorization.service.js';
import type { IngestFxRateDto } from './fx-rate.dto.js';

const RATE_PRECISION = 18;

@Injectable()
export class FxRateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly platformAuthorization: PlatformAuthorizationService,
    private readonly outbox: PrismaOutboxWriter,
  ) {}

  async ingest(principal: AuthPrincipal, input: IngestFxRateDto, rawIdempotencyKey?: string): Promise<unknown> {
    const platformActor = this.platformAuthorization.assertPlatformAdmin(principal);
    const ingestUsers = this.config.get<string[]>('PLATFORM_PRICING_FX_INGEST_USER_IDS') ?? [];
    if (!ingestUsers.includes(platformActor.userId)) throw new ForbiddenException('FX ingestion capability required');

    const key = this.requireIdempotencyKey(rawIdempotencyKey);
    const sources = this.config.get<string[]>('PRICING_FX_ALLOWED_SOURCES') ?? [];
    if (!sources.includes(input.sourceCode)) throw new ForbiddenException('FX source is not approved');
    if (input.baseCurrency === input.quoteCurrency) throw new BadRequestException('FX currencies must be different');

    const rate = new Prisma.Decimal(input.rate);
    if (!rate.isFinite() || !rate.gt(0)) throw new BadRequestException('FX rate must be positive');
    const normalizedRate = rate.toFixed(RATE_PRECISION);
    const observedAt = this.parseDate(input.observedAt, 'observedAt');
    const validFrom = this.parseDate(input.validFrom, 'validFrom');
    const validUntil = this.parseDate(input.validUntil, 'validUntil');
    const sourceReference = input.sourceReference.trim();
    if (!sourceReference) throw new BadRequestException('sourceReference is required');
    if (validUntil <= validFrom) throw new BadRequestException('validUntil must be later than validFrom');

    const canonicalPayload = {
      baseCurrency: input.baseCurrency,
      quoteCurrency: input.quoteCurrency,
      rate: normalizedRate,
      sourceCode: input.sourceCode,
      observedAt: observedAt.toISOString(),
      validFrom: validFrom.toISOString(),
      validUntil: validUntil.toISOString(),
      sourceReference,
    };
    const payloadHash = createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
    const context = currentEventContext() ?? createRequestContext();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const receipt = await tx.fxRateIngestionReceipt.findUnique({ where: { actorUserId_idempotencyKey: { actorUserId: platformActor.userId, idempotencyKey: key } }, include: { fxRate: true } });
        if (receipt) {
          if (receipt.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used for another FX rate command');
          return this.serialize(receipt.fxRate);
        }

        const priorSourceRecord = await tx.fxRate.findUnique({ where: { sourceCode_sourceReference: { sourceCode: input.sourceCode, sourceReference } } });
        if (priorSourceRecord) {
          if (priorSourceRecord.commandPayloadHash !== payloadHash) throw new ConflictException('Source reference was already recorded with different FX data');
          await tx.fxRateIngestionReceipt.create({ data: { id: randomUUID(), actorUserId: platformActor.userId, idempotencyKey: key, payloadHash, fxRateId: priorSourceRecord.id } });
          return this.serialize(priorSourceRecord);
        }

        const activeCurrencies = await tx.$queryRaw<Array<{ code: string }>>(Prisma.sql`
          SELECT code FROM currency_definitions
          WHERE code IN (${input.baseCurrency}, ${input.quoteCurrency}) AND active = TRUE
          FOR SHARE
        `);
        if (activeCurrencies.length !== 2) throw new BadRequestException('FX currencies must exist and be active in the currency registry');

        const fxRate = await tx.fxRate.create({
          data: {
            id: randomUUID(), baseCurrencyCode: input.baseCurrency, quoteCurrencyCode: input.quoteCurrency,
            rate: normalizedRate, sourceCode: input.sourceCode, sourceReference, observedAt, validFrom, validUntil,
            commandPayloadHash: payloadHash, ingestedByUserId: platformActor.userId,
          },
        });
        await tx.fxRateIngestionReceipt.create({ data: { id: randomUUID(), actorUserId: platformActor.userId, idempotencyKey: key, payloadHash, fxRateId: fxRate.id } });
        await tx.auditEvent.create({
          data: {
            id: randomUUID(), action: 'PRICING_FX_RATE_INGESTED', actorUserId: platformActor.userId, organizationId: null,
            targetType: 'FxRate', targetId: fxRate.id, requestId: context.requestId ?? null, correlationId: context.correlationId,
            metadataJson: { baseCurrency: fxRate.baseCurrencyCode, quoteCurrency: fxRate.quoteCurrencyCode, sourceCode: fxRate.sourceCode, payloadHash },
          },
        });
        await this.outbox.enqueue(tx, createDomainEvent({
          eventType: 'pricing.fx_rate.ingested', eventVersion: 1, occurredAt: new Date().toISOString(),
          actor: { type: 'PLATFORM', id: platformActor.userId }, aggregate: { type: 'FxRate', id: fxRate.id },
          correlationId: context.correlationId, ...(context.requestId ? { requestId: context.requestId } : {}),
          dataClassification: 'INTERNAL', purpose: 'shared-pricing-fx-rate-registry',
          payload: { fxRateId: fxRate.id, baseCurrency: fxRate.baseCurrencyCode, quoteCurrency: fxRate.quoteCurrencyCode, sourceCode: fxRate.sourceCode, payloadHash },
        }));
        return this.serialize(fxRate);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.resolveConcurrentReplay(platformActor.userId, key, payloadHash, input.sourceCode, sourceReference);
      }
      throw error;
    }
  }

  private async resolveConcurrentReplay(actorUserId: string, idempotencyKey: string, payloadHash: string, sourceCode: string, sourceReference: string): Promise<unknown> {
    const receipt = await this.prisma.fxRateIngestionReceipt.findUnique({ where: { actorUserId_idempotencyKey: { actorUserId, idempotencyKey } }, include: { fxRate: true } });
    if (receipt) {
      if (receipt.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used for another FX rate command');
      return this.serialize(receipt.fxRate);
    }
    const prior = await this.prisma.fxRate.findUnique({ where: { sourceCode_sourceReference: { sourceCode, sourceReference } } });
    if (prior?.commandPayloadHash !== payloadHash) throw new ConflictException('Source reference was already recorded with different FX data');
    if (!prior) throw new ConflictException('Concurrent FX rate ingestion conflicted; retry with the same idempotency key');
    try {
      await this.prisma.fxRateIngestionReceipt.create({ data: { id: randomUUID(), actorUserId, idempotencyKey, payloadHash, fxRateId: prior.id } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
    const replay = await this.prisma.fxRateIngestionReceipt.findUnique({ where: { actorUserId_idempotencyKey: { actorUserId, idempotencyKey } }, include: { fxRate: true } });
    if (replay?.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used for another FX rate command');
    return this.serialize(replay.fxRate);
  }

  private requireIdempotencyKey(value?: string): string {
    const key = value?.trim();
    if (!key || key.length < 16 || key.length > 200 || /[\r\n]/.test(key)) throw new BadRequestException('Idempotency-Key must contain 16 to 200 characters');
    return key;
  }

  private parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid RFC3339 timestamp`);
    return date;
  }

  private serialize(rate: { id: string; baseCurrencyCode: string; quoteCurrencyCode: string; rate: Prisma.Decimal; sourceCode: string; sourceReference: string; observedAt: Date; validFrom: Date; validUntil: Date }): Record<string, unknown> {
    return {
      id: rate.id, baseCurrency: rate.baseCurrencyCode, quoteCurrency: rate.quoteCurrencyCode, rate: rate.rate.toFixed(RATE_PRECISION),
      sourceCode: rate.sourceCode, sourceReference: rate.sourceReference, observedAt: rate.observedAt.toISOString(),
      validFrom: rate.validFrom.toISOString(), validUntil: rate.validUntil.toISOString(),
    };
  }
}
