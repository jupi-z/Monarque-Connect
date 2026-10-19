import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type AbuseDimension = 'ACTOR' | 'ORGANIZATION' | 'RELATION';
type RateBucketRow = {
  id: string;
  dimension: AbuseDimension;
  attempt_count: number;
  accepted_count: number;
  rejected_count: number;
  blocked_until: Date | null;
  window_ends: Date;
  fingerprint_count: number;
};

export type AbuseReservation = {
  allowed: boolean;
  retryAfterSeconds: number;
  dimensions: Array<{ dimension: AbuseDimension; attempts: number; rejected: number }>;
};

const WINDOW_MS = 60_000;
const MIN_INTERVAL_MS = 1_000;
const LIMITS: Record<AbuseDimension, number> = { ACTOR: 20, ORGANIZATION: 200, RELATION: 100 };

@Injectable()
export class MessagingAbuseService {
  async reserve(
    tx: Prisma.TransactionClient,
    input: { actorUserId: string; organizationId: string; targetOrganizationId: string; conversationId: string; body: string },
    now = new Date(),
  ): Promise<AbuseReservation> {
    const windowStarted = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
    const windowEnds = new Date(windowStarted.getTime() + WINDOW_MS);
    const fingerprint = this.fingerprint(input.body);
    const keys: Array<{ dimension: AbuseDimension; value: string; organizationId: string }> = [
      { dimension: 'ACTOR', value: input.actorUserId, organizationId: input.organizationId },
      { dimension: 'ORGANIZATION', value: input.organizationId, organizationId: input.organizationId },
      { dimension: 'RELATION', value: [input.organizationId, input.targetOrganizationId].sort().join(':'), organizationId: input.organizationId },
    ];
    const rows: RateBucketRow[] = [];
    for (const key of keys) rows.push(await this.upsertAndLock(tx, key, key.dimension === 'RELATION' ? input.conversationId : null, windowStarted, windowEnds, fingerprint));

    const blockedUntil = rows.reduce<Date | null>((latest, row) => row.blocked_until && (!latest || row.blocked_until > latest) ? row.blocked_until : latest, null);
    const exceeded = rows.some((row) => row.attempt_count > LIMITS[row.dimension] || row.fingerprint_count > 3);
    const allowed = (!blockedUntil || blockedUntil <= now) && !exceeded;
    const retryAt = exceeded ? windowEnds : blockedUntil && blockedUntil > now ? blockedUntil : new Date(now.getTime() + MIN_INTERVAL_MS);
    const retryAfterSeconds = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000));
    for (const row of rows) {
      if (allowed) await tx.$executeRaw(Prisma.sql`UPDATE "messaging_rate_buckets" SET "accepted_count" = "accepted_count" + 1, "blocked_until" = ${new Date(now.getTime() + MIN_INTERVAL_MS)}, "updated_at" = NOW() WHERE "id" = ${row.id}::uuid`);
      else await tx.$executeRaw(Prisma.sql`UPDATE "messaging_rate_buckets" SET "rejected_count" = "rejected_count" + 1, "blocked_until" = ${retryAt}, "updated_at" = NOW() WHERE "id" = ${row.id}::uuid`);
    }
    return { allowed, retryAfterSeconds, dimensions: rows.map((row) => ({ dimension: row.dimension, attempts: row.attempt_count, rejected: row.rejected_count + (allowed ? 0 : 1) })) };
  }

  private async upsertAndLock(tx: Prisma.TransactionClient, key: { dimension: AbuseDimension; value: string; organizationId: string }, conversationId: string | null, windowStarted: Date, windowEnds: Date, fingerprint: string): Promise<RateBucketRow> {
    const keyHash = createHash('sha256').update(`${key.dimension}:${key.value}`).digest('hex');
    const rows = await tx.$queryRaw<RateBucketRow[]>(Prisma.sql`
      INSERT INTO "messaging_rate_buckets" ("id", "organization_id", "conversation_id", "dimension", "dimension_key_hash", "window_started", "window_ends", "attempt_count", "accepted_count", "rejected_count", "blocked_until", "content_fingerprint_hmac", "fingerprint_count", "created_at", "updated_at")
      VALUES (${randomUUID()}::uuid, ${key.organizationId}::uuid, ${conversationId}::uuid, ${key.dimension}, ${keyHash}, ${windowStarted}, ${windowEnds}, 1, 0, 0, NULL, NULL, 0, NOW(), NOW())
      ON CONFLICT ("dimension", "dimension_key_hash", "window_started") DO UPDATE SET
        "attempt_count" = "messaging_rate_buckets"."attempt_count" + 1,
        "updated_at" = NOW()
      RETURNING "id", "dimension", "attempt_count", "accepted_count", "rejected_count", "blocked_until", "window_ends", "fingerprint_count"
    `);
    if (rows.length !== 1) throw new Error('Messaging rate bucket upsert did not return one row');
    const fingerprints = await tx.$queryRaw<Array<{ fingerprint_count: number }>>(Prisma.sql`
      INSERT INTO "messaging_rate_bucket_fingerprints" ("id", "rate_bucket_id", "fingerprint_hmac", "attempt_count", "created_at", "updated_at")
      VALUES (${randomUUID()}::uuid, ${rows[0]!.id}::uuid, ${fingerprint}, 1, NOW(), NOW())
      ON CONFLICT ("rate_bucket_id", "fingerprint_hmac") DO UPDATE SET
        "attempt_count" = "messaging_rate_bucket_fingerprints"."attempt_count" + 1,
        "updated_at" = NOW()
      RETURNING "attempt_count" AS "fingerprint_count"
    `);
    if (fingerprints.length !== 1) throw new Error('Messaging rate bucket fingerprint upsert did not return one row');
    return { ...rows[0]!, fingerprint_count: fingerprints[0]!.fingerprint_count };
  }

  private fingerprint(body: string): string {
    const configured = process.env.MESSAGING_ABUSE_HMAC_KEY;
    const nodeEnv = process.env.NODE_ENV ?? 'development';
    if (!configured && nodeEnv !== 'development' && nodeEnv !== 'test') {
      throw new Error('MESSAGING_ABUSE_HMAC_KEY is required outside local development and tests');
    }
    const key = configured ?? 'monarque-connect-test-only-messaging-abuse-key';
    return createHmac('sha256', key).update(body).digest('hex');
  }
}
