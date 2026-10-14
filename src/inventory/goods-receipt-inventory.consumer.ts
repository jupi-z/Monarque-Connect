import { randomUUID } from 'node:crypto';
import { validate as isUuid } from 'uuid';
import { Prisma } from '@prisma/client';
import type { ClaimedOutboxEvent, EventDbClient } from '../events/outbox.repository.js';
import { PermanentEventError } from '../events/event-dispatcher.js';
import type { GoodsReceiptInventoryEventPayload } from '../purchases/goods-receipt.events.js';

type EventLine = { goodsReceiptLineId: string; itemId: string | null; deltaQuantity: string };
type ParsedPayload = {
  goodsReceiptId: string;
  purchaseOrderId?: string;
  establishmentId?: string;
  sourceRevision?: string;
  lines?: EventLine[];
};
type ReceiptRow = { purchase_order_id: string; establishment_id: string; status: string; received_at: Date };
type ReceiptLineRow = { id: string; item_id: string | null; quantity: string };

export class GoodsReceiptInventoryConsumer {
  readonly consumerName = 'inventory-goods-receipt';

  async handle(client: EventDbClient, event: ClaimedOutboxEvent): Promise<void> {
    const payload = this.parse(event.payload);
    if (!event.organizationId || !event.establishmentId) throw new PermanentEventError('Goods receipt inventory event has no tenant context');
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`goods-receipt-inventory:${event.organizationId}:${payload.goodsReceiptId}`]);
    const receipt = await client.query<ReceiptRow>(
      `SELECT gr.purchase_order_id, gr.establishment_id, gr.status, gr.received_at
       FROM goods_receipts gr
       JOIN purchase_orders po ON po.id = gr.purchase_order_id AND po.organization_id = gr.organization_id
       WHERE gr.id = $1 AND gr.organization_id = $2 FOR SHARE`,
      [payload.goodsReceiptId, event.organizationId],
    );
    if (receipt.rowCount !== 1 || receipt.rows[0]?.status !== 'CONFIRMED') throw new PermanentEventError('Goods receipt is not confirmed or tenant-scoped');
    const receiptRow = receipt.rows[0];
    const establishmentId = payload.establishmentId ?? event.establishmentId;
    if (receiptRow.establishment_id !== establishmentId || event.establishmentId !== receiptRow.establishment_id) throw new PermanentEventError('Goods receipt event establishment mismatch');
    if (payload.purchaseOrderId && receiptRow.purchase_order_id !== payload.purchaseOrderId) throw new PermanentEventError('Goods receipt event purchase order mismatch');

    const resolved = await this.resolveFacts(client, event.eventType, payload, event.organizationId, event.id);
    if (event.eventType === 'purchases.goods_receipt.corrected.v1') {
      const confirmed = await client.query(
        `SELECT 1 FROM goods_receipt_inventory_entries
         WHERE organization_id = $1 AND goods_receipt_id = $2 AND source_revision IN ('CONFIRMED', 'LEGACY_CONFIRMED')
         LIMIT 1`,
        [event.organizationId, payload.goodsReceiptId],
      );
      if (confirmed.rowCount !== 1) throw new Error('Goods receipt confirmation projection must be processed before its correction');
    }

    const consumed = await client.query(
      `INSERT INTO event_consumer_receipts (id, consumer_name, event_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (consumer_name, event_id) DO NOTHING
       RETURNING id`,
      [randomUUID(), this.consumerName, event.id],
    );
    if (consumed.rowCount === 0) return;

    const link = await client.query<{ id: string; warehouse_id: string | null }>(
      `INSERT INTO goods_receipt_inventory_links
       (id, organization_id, establishment_id, goods_receipt_id, status, source_revision, decision_source, reason, updated_at)
       VALUES ($1, $2, $3, $4, 'PENDING_ASSIGNMENT', 'EVENT_STREAM', 'EVENT_ASSIGNMENT', $5, now())
       ON CONFLICT (goods_receipt_id, organization_id) DO NOTHING
       RETURNING id, warehouse_id`,
      [randomUUID(), event.organizationId, payload.establishmentId, payload.goodsReceiptId, 'Awaiting explicit warehouse assignment'],
    );
    const linkRow = link.rows[0] ?? (await client.query<{ id: string; warehouse_id: string | null }>(
      `SELECT id, warehouse_id FROM goods_receipt_inventory_links WHERE goods_receipt_id = $1 AND organization_id = $2 FOR UPDATE`,
      [payload.goodsReceiptId, event.organizationId],
    )).rows[0];
    if (!linkRow) throw new Error('Goods receipt inventory link was not created');

    for (const line of resolved.lines) {
      await client.query(
        `INSERT INTO goods_receipt_inventory_entries
         (id, organization_id, link_id, goods_receipt_id, goods_receipt_line_id, item_id, source_event_id, source_revision, delta_quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric)
         ON CONFLICT (organization_id, goods_receipt_line_id, source_revision) DO NOTHING`,
        [randomUUID(), event.organizationId, linkRow.id, payload.goodsReceiptId, line.goodsReceiptLineId, line.itemId, event.id, resolved.sourceRevision, line.deltaQuantity],
      );
    }
    if (linkRow.warehouse_id) await this.applyEntries(client, event, { goodsReceiptId: payload.goodsReceiptId, establishmentId: receiptRow.establishment_id, sourceRevision: resolved.sourceRevision, lines: resolved.lines }, linkRow.id, linkRow.warehouse_id, receiptRow.received_at);
  }

  private async resolveFacts(client: EventDbClient, eventType: string, payload: ParsedPayload, organizationId: string, eventId: string): Promise<{ sourceRevision: string; lines: EventLine[] }> {
    const actual = await client.query<ReceiptLineRow>(
      `SELECT id, item_id, quantity::text FROM goods_receipt_lines WHERE organization_id = $1 AND goods_receipt_id = $2 ORDER BY line_index, id`,
      [organizationId, payload.goodsReceiptId],
    );
    if (eventType === 'purchases.goods_receipt.confirmed.v1') {
      const supplied = payload.lines;
      if (!supplied || payload.sourceRevision !== 'CONFIRMED') return { sourceRevision: 'LEGACY_CONFIRMED', lines: actual.rows.map((line) => ({ goodsReceiptLineId: line.id, itemId: line.item_id, deltaQuantity: line.quantity })) };
      this.assertExactLines(supplied, actual.rows, false);
      return { sourceRevision: 'CONFIRMED', lines: supplied };
    }
    if (eventType !== 'purchases.goods_receipt.corrected.v1') throw new PermanentEventError('Unsupported goods receipt inventory event type');
    const sourceRevision = payload.sourceRevision;
    if (sourceRevision && isUuid(sourceRevision) && payload.lines) {
      const correction = await client.query<{ goods_receipt_line_id: string; item_id: string | null; delta_quantity: string }>(
        `SELECT cl.goods_receipt_line_id, grl.item_id, cl.delta_quantity::text
         FROM goods_receipt_correction_lines cl
         JOIN goods_receipt_lines grl ON grl.id = cl.goods_receipt_line_id AND grl.goods_receipt_id = cl.goods_receipt_id AND grl.organization_id = cl.organization_id
         WHERE cl.organization_id = $1 AND cl.goods_receipt_id = $2 AND cl.correction_id = $3
         ORDER BY cl.goods_receipt_line_id`,
        [organizationId, payload.goodsReceiptId, sourceRevision],
      );
      if (correction.rowCount === 0) throw new PermanentEventError('Goods receipt correction does not exist in the tenant');
      this.assertExactLines(payload.lines, correction.rows.map((line) => ({ id: line.goods_receipt_line_id, item_id: line.item_id, quantity: line.delta_quantity })), true);
      return { sourceRevision, lines: payload.lines };
    }
    const projected = await client.query<{ goods_receipt_line_id: string; delta_quantity: string }>(
      `SELECT goods_receipt_line_id, COALESCE(SUM(delta_quantity), 0)::text AS delta_quantity
       FROM goods_receipt_inventory_entries WHERE organization_id = $1 AND goods_receipt_id = $2 GROUP BY goods_receipt_line_id`,
      [organizationId, payload.goodsReceiptId],
    );
    const projectedByLine = new Map(projected.rows.map((line) => [line.goods_receipt_line_id, new Prisma.Decimal(line.delta_quantity)]));
    const corrections = await client.query<{ goods_receipt_line_id: string; delta_quantity: string }>(
      `SELECT cl.goods_receipt_line_id, cl.delta_quantity::text
       FROM goods_receipt_correction_lines cl WHERE cl.organization_id = $1 AND cl.goods_receipt_id = $2`,
      [organizationId, payload.goodsReceiptId],
    );
    const correctionByLine = new Map<string, Prisma.Decimal>();
    for (const line of corrections.rows) correctionByLine.set(line.goods_receipt_line_id, (correctionByLine.get(line.goods_receipt_line_id) ?? new Prisma.Decimal(0)).add(line.delta_quantity));
    const lines = actual.rows.flatMap((line) => {
      const delta = new Prisma.Decimal(line.quantity).add(correctionByLine.get(line.id) ?? 0).sub(projectedByLine.get(line.id) ?? 0);
      return delta.isZero() ? [] : [{ goodsReceiptLineId: line.id, itemId: line.item_id, deltaQuantity: delta.toFixed(6) }];
    });
    return { sourceRevision: sourceRevision || `LEGACY_CORRECTION_${eventId}`, lines };
  }

  private assertExactLines(supplied: EventLine[], expected: Array<{ id: string; item_id: string | null; quantity: string }>, signed: boolean): void {
    if (supplied.length !== expected.length || new Set(supplied.map((line) => line.goodsReceiptLineId)).size !== supplied.length) throw new PermanentEventError('Goods receipt inventory event lines do not match persisted receipt facts');
    const actualById = new Map(expected.map((line) => [line.id, line]));
    for (const line of supplied) {
      const expectedLine = actualById.get(line.goodsReceiptLineId);
      if (!expectedLine || expectedLine.item_id !== line.itemId || (!signed && Number(line.deltaQuantity) <= 0) || this.canonical(line.deltaQuantity) !== this.canonical(expectedLine.quantity)) throw new PermanentEventError('Goods receipt inventory event line facts do not match persisted facts');
    }
  }

  private canonical(value: string): string {
    const negative = value.startsWith('-');
    const unsigned = negative ? value.slice(1) : value;
    const [integer = '0', fraction = ''] = unsigned.split('.');
    const normalized = `${integer.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(6, '0')}`;
    return `${negative ? '-' : ''}${normalized}`;
  }

  private async applyEntries(client: EventDbClient, event: ClaimedOutboxEvent, payload: { goodsReceiptId: string; establishmentId: string; sourceRevision: string; lines: EventLine[] }, linkId: string, warehouseId: string, receivedAt: Date): Promise<void> {
    const entries = await client.query<{ id: string; goods_receipt_id: string; goods_receipt_line_id: string; item_id: string | null; source_revision: string; delta_quantity: string }>(
      `SELECT id, goods_receipt_id, goods_receipt_line_id, item_id, source_revision, delta_quantity::text
       FROM goods_receipt_inventory_entries
       WHERE organization_id = $1 AND link_id = $2 AND inventory_movement_id IS NULL
       ORDER BY created_at, id
       FOR UPDATE`,
      [event.organizationId, linkId],
    );
    const actorId = event.actorId ?? event.aggregateId;
    for (const entry of entries.rows) {
      if (!entry.item_id) throw new PermanentEventError('Goods receipt line has no inventory item');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${event.organizationId}:${warehouseId}:${entry.item_id}`]);
      const valid = await client.query(
        `SELECT 1 FROM warehouses w
         JOIN items i ON i.organization_id = w.organization_id
         WHERE w.id = $1 AND w.organization_id = $2 AND w.establishment_id = $3 AND w.active = true
           AND i.id = $4 AND i.active = true AND i.track_inventory = true`,
        [warehouseId, event.organizationId, payload.establishmentId, entry.item_id],
      );
      if (valid.rowCount !== 1) throw new PermanentEventError('Inventory warehouse or item is not active and tenant-scoped');
      const next = await client.query<{ next_quantity: string }>(
        `SELECT ($1::numeric + COALESCE((SELECT quantity FROM inventory_balances WHERE organization_id = $2 AND warehouse_id = $3 AND item_id = $4 FOR UPDATE), 0))::text AS next_quantity`,
        [entry.delta_quantity, event.organizationId, warehouseId, entry.item_id],
      );
      const nextQuantity = next.rows[0]?.next_quantity;
      if (!nextQuantity || Number(nextQuantity) < 0) throw new PermanentEventError('Goods receipt correction would make inventory negative');
      const movementId = randomUUID();
      const movementType = Number(entry.delta_quantity) > 0 ? 'RECEIPT_IN' : 'ADJUSTMENT_OUT';
      await client.query(
        `INSERT INTO inventory_movements
         (id, organization_id, establishment_id, warehouse_id, item_id, movement_type, source_type, quantity_delta, source_id, source_line_id, source_revision, idempotency_key, reason, occurred_at, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'GOODS_RECEIPT', $7::numeric, $8, $9, $10, $11, $12, $13, $14)`,
        [movementId, event.organizationId, payload.establishmentId, warehouseId, entry.item_id, movementType, entry.delta_quantity, entry.goods_receipt_id, entry.goods_receipt_line_id, entry.source_revision, `goods-receipt-inventory:${entry.id}`, `Goods receipt ${payload.goodsReceiptId}`, receivedAt, actorId],
      );
      await client.query(
        `INSERT INTO inventory_balances (organization_id, warehouse_id, item_id, quantity, updated_at)
         VALUES ($1, $2, $3, $4::numeric, now())
         ON CONFLICT (organization_id, warehouse_id, item_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
        [event.organizationId, warehouseId, entry.item_id, nextQuantity],
      );
      await client.query(`UPDATE goods_receipt_inventory_entries SET inventory_movement_id = $1 WHERE id = $2 AND inventory_movement_id IS NULL`, [movementId, entry.id]);
      const metadata = { movementType, sourceType: 'GOODS_RECEIPT', sourceRevision: entry.source_revision, goodsReceiptId: entry.goods_receipt_id, goodsReceiptLineId: entry.goods_receipt_line_id, quantityDelta: entry.delta_quantity, warehouseId, itemId: entry.item_id, balanceAfter: nextQuantity };
      await client.query(
        `INSERT INTO audit_events (id, action, actor_user_id, organization_id, establishment_id, target_type, target_id, request_id, correlation_id, metadata_json)
         VALUES ($1, 'INVENTORY_MOVEMENT_CREATED', $2, $3, $4, 'InventoryMovement', $5, $6, $7, $8::jsonb)`,
        [randomUUID(), event.actorId, event.organizationId, payload.establishmentId, movementId, event.requestId, event.correlationId, JSON.stringify(metadata)],
      );
      await client.query(
        `INSERT INTO outbox_events
         (id, event_type, event_version, occurred_at, organization_id, establishment_id, actor_type, actor_id, aggregate_type, aggregate_id, correlation_id, causation_id, request_id, data_classification, purpose, payload_json)
         VALUES ($1, 'inventory.movement.created', 1, now(), $2, $3, 'SYSTEM', NULL, 'InventoryMovement', $4, $5, $6, $7, 'CONFIDENTIAL', 'inventory-ledger', $8::jsonb)`,
        [randomUUID(), event.organizationId, payload.establishmentId, movementId, event.correlationId, event.id, event.requestId, JSON.stringify(metadata)],
      );
    }
  }

  private parse(value: Record<string, unknown>): ParsedPayload {
    const payload = value as Partial<GoodsReceiptInventoryEventPayload>;
    if (!payload.goodsReceiptId || !isUuid(payload.goodsReceiptId)) throw new PermanentEventError('Goods receipt inventory event payload is invalid');
    if (payload.purchaseOrderId !== undefined && (!isUuid(payload.purchaseOrderId) || typeof payload.purchaseOrderId !== 'string')) throw new PermanentEventError('Goods receipt inventory event purchase order is invalid');
    if (payload.establishmentId !== undefined && (!isUuid(payload.establishmentId) || typeof payload.establishmentId !== 'string')) throw new PermanentEventError('Goods receipt inventory event establishment is invalid');
    if (payload.sourceRevision !== undefined && typeof payload.sourceRevision !== 'string') throw new PermanentEventError('Goods receipt inventory event source revision is invalid');
    if (payload.lines !== undefined) {
      if (!Array.isArray(payload.lines)) throw new PermanentEventError('Goods receipt inventory event lines are invalid');
      const lines = payload.lines as EventLine[];
      if (lines.some((line) => !line || !isUuid(line.goodsReceiptLineId) || (line.itemId !== null && !isUuid(line.itemId)) || typeof line.deltaQuantity !== 'string' || !/^-?\d+(?:\.\d{1,6})?$/.test(line.deltaQuantity) || Number(line.deltaQuantity) === 0)) throw new PermanentEventError('Goods receipt inventory event line is invalid');
      return { ...(payload.purchaseOrderId ? { purchaseOrderId: payload.purchaseOrderId } : {}), ...(payload.establishmentId ? { establishmentId: payload.establishmentId } : {}), ...(payload.sourceRevision ? { sourceRevision: payload.sourceRevision } : {}), goodsReceiptId: payload.goodsReceiptId, lines };
    }
    return { ...(payload.purchaseOrderId ? { purchaseOrderId: payload.purchaseOrderId } : {}), ...(payload.establishmentId ? { establishmentId: payload.establishmentId } : {}), ...(payload.sourceRevision ? { sourceRevision: payload.sourceRevision } : {}), goodsReceiptId: payload.goodsReceiptId };
  }
}
