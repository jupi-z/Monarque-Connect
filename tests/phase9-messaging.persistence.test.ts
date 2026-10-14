import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPool } from './events/test-database.js';

const messagingTables = [
  'conversations',
  'conversation_organization_participants',
  'conversation_user_participants',
  'messaging_invitations',
  'messages',
  'messaging_organization_blocks',
  'messaging_rate_buckets',
];

async function constraintDefinitions(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c
     JOIN pg_class r ON r.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'public' AND r.relname = ANY($1::text[])`,
    [messagingTables],
  );
  return result.rows.map((row) => row.definition.replaceAll('"', '').replace(/\s+/g, ' '));
}

describe('Phase 9 Messaging persistence schema', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates the tenant-scoped messaging tables and enums', async () => {
    const result = await pool.query<{ tableName: string | null }>(
      'SELECT to_regclass(format(\'public.%s\', table_name)) AS "tableName" FROM unnest($1::text[]) AS table_name',
      [messagingTables],
    );
    expect(result.rows.map((row) => row.tableName)).toEqual(messagingTables);

    const enums = await pool.query<{ typname: string }>(
      'SELECT typname FROM pg_type WHERE typname = ANY($1::text[])',
      [[
        'MessagingConversationStatus',
        'MessagingInvitationType',
        'MessagingInvitationStatus',
        'MessagingParticipantStatus',
      ]],
    );
    expect(enums.rows.map((row) => row.typname)).toEqual(
      expect.arrayContaining([
        'MessagingConversationStatus',
        'MessagingInvitationType',
        'MessagingInvitationStatus',
        'MessagingParticipantStatus',
      ]),
    );
  });

  it('enforces canonical organization pairs, message ordering and idempotency', async () => {
    const constraints = await constraintDefinitions(pool);
    expect(constraints.some((definition) => definition.includes('organization_low_id <> organization_high_id'))).toBe(true);
    expect(constraints.some((definition) => definition.includes('organization_low_id < organization_high_id'))).toBe(true);
    expect(constraints.some((definition) => definition.includes('last_message_sequence >= 0'))).toBe(true);
    expect(constraints.some((definition) => definition.includes('history_visible_from_sequence >= 0'))).toBe(true);
    expect(constraints.some((definition) => definition.includes('sequence >= 1'))).toBe(true);

    const indexes = await pool.query<{ definition: string }>(
      `SELECT indexdef AS definition
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [messagingTables],
    );
    const definitions = indexes.rows.map((row) => row.definition.replaceAll('"', '').replace(/\s+/g, ' '));
    expect(definitions.some((definition) => definition.includes('conversations') && definition.includes('organization_low_id, organization_high_id'))).toBe(true);
    expect(definitions.some((definition) => definition.includes('messages') && definition.includes('conversation_id, sequence'))).toBe(true);
    expect(definitions.some((definition) => definition.includes('messages') && definition.includes('conversation_id, author_user_id, client_message_id'))).toBe(true);
    expect(definitions.some((definition) => definition.includes('conversation_user_participants') && definition.includes('conversation_id, organization_id, user_id'))).toBe(true);
  });

  it('rejects direct SQL updates and deletes of an immutable message', async () => {
    const client = await pool.connect();
    const businessTypeCode = `PHASE9_TEST_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const organizationIds = [randomUUID(), randomUUID()].sort();
    const lowOrganizationId = organizationIds[0]!;
    const highOrganizationId = organizationIds[1]!;
    const thirdOrganizationId = randomUUID();
    const userId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO business_types (code, name, description, active, sort_order)
         VALUES ($1, 'Phase 9 test', 'Ephemeral integration-test type', true, 0)`,
        [businessTypeCode],
      );
      await client.query(
        `INSERT INTO users (id, email, normalized_email, password_hash, first_name, last_name, updated_at)
         VALUES ($1, $2, $2, 'not-used', 'Phase', 'Nine', CURRENT_TIMESTAMP)`,
        [userId, `${userId}@example.test`],
      );
      await client.query(
        `INSERT INTO organizations (id, business_type_code, name, handle, default_currency, updated_at)
         VALUES
           ($1, $3, 'Phase 9 Low', $4, 'EUR', CURRENT_TIMESTAMP),
           ($2, $3, 'Phase 9 High', $5, 'EUR', CURRENT_TIMESTAMP),
           ($6, $3, 'Phase 9 Third', $7, 'EUR', CURRENT_TIMESTAMP)`,
        [lowOrganizationId, highOrganizationId, businessTypeCode, `phase9-low-${lowOrganizationId.slice(0, 8)}`, `phase9-high-${highOrganizationId.slice(0, 8)}`, thirdOrganizationId, `phase9-third-${thirdOrganizationId.slice(0, 8)}`],
      );
      await client.query(
        `INSERT INTO conversations (id, organization_low_id, organization_high_id, last_message_sequence, created_by_user_id, updated_at)
         VALUES ($1, $2, $3, 1, $4, CURRENT_TIMESTAMP)`,
        [conversationId, lowOrganizationId, highOrganizationId, userId],
      );
      await client.query(
        `INSERT INTO conversation_organization_participants
          (id, conversation_id, organization_id, status, joined_at, history_visible_from_sequence, created_by_user_id, updated_at)
         VALUES
          ($1, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP, 0, $2, CURRENT_TIMESTAMP),
          ($5, $3, $6, 'ACTIVE', CURRENT_TIMESTAMP, 0, $2, CURRENT_TIMESTAMP)`,
        [randomUUID(), userId, conversationId, lowOrganizationId, randomUUID(), highOrganizationId],
      );
      await client.query('SAVEPOINT before_duplicate_participant');
      await expect(
        client.query(
          `INSERT INTO conversation_organization_participants
            (id, conversation_id, organization_id, status, joined_at, history_visible_from_sequence, created_by_user_id, updated_at)
           VALUES ($1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP, 0, $4, CURRENT_TIMESTAMP)`,
          [randomUUID(), conversationId, lowOrganizationId, userId],
        ),
      ).rejects.toThrow(/duplicate key/i);
      await client.query('ROLLBACK TO SAVEPOINT before_duplicate_participant');
      await client.query('SAVEPOINT before_cross_tenant_participant');
      await client.query(
        `INSERT INTO conversation_organization_participants
          (id, conversation_id, organization_id, status, joined_at, history_visible_from_sequence, created_by_user_id, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP, 0, $4, CURRENT_TIMESTAMP)`,
        [randomUUID(), conversationId, thirdOrganizationId, userId],
      );
      await expect(client.query('SET CONSTRAINTS "conversation_organization_participants_pair_guard" IMMEDIATE')).rejects.toThrow(/messaging_participant_organization_mismatch/i);
      await client.query('ROLLBACK TO SAVEPOINT before_cross_tenant_participant');
      await client.query(
        `INSERT INTO messages (id, conversation_id, sequence, author_user_id, source_organization_id, client_message_id, body)
         VALUES ($1, $2, 1, $3, $4, 'client-1', 'immutable body')`,
        [messageId, conversationId, userId, lowOrganizationId],
      );

      await client.query('SAVEPOINT before_message_update');
      await expect(client.query('UPDATE messages SET body = \'mutated\' WHERE id = $1', [messageId])).rejects.toThrow(/message_immutable/i);
      await client.query('ROLLBACK TO SAVEPOINT before_message_update');
      await client.query('SAVEPOINT before_message_delete');
      await expect(client.query('DELETE FROM messages WHERE id = $1', [messageId])).rejects.toThrow(/message_immutable/i);
      await client.query('ROLLBACK TO SAVEPOINT before_message_delete');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
