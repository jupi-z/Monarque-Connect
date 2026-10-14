export interface GoodsReceiptInventoryEventLine {
  goodsReceiptLineId: string;
  itemId: string | null;
  deltaQuantity: string;
}

export interface GoodsReceiptInventoryEventPayload {
  [key: string]: unknown;
  goodsReceiptId: string;
  purchaseOrderId: string;
  establishmentId: string;
  sourceRevision: string;
  lines: GoodsReceiptInventoryEventLine[];
}

export function buildGoodsReceiptConfirmedPayload(input: {
  goodsReceiptId: string;
  purchaseOrderId: string;
  establishmentId: string;
  lines: Array<{ goodsReceiptLineId: string; itemId: string | null; quantity: string }>;
}): GoodsReceiptInventoryEventPayload {
  return {
    goodsReceiptId: input.goodsReceiptId,
    purchaseOrderId: input.purchaseOrderId,
    establishmentId: input.establishmentId,
    sourceRevision: 'CONFIRMED',
    lines: input.lines.map((line) => ({
      goodsReceiptLineId: line.goodsReceiptLineId,
      itemId: line.itemId,
      deltaQuantity: line.quantity,
    })),
  };
}

export function buildGoodsReceiptCorrectedPayload(input: GoodsReceiptInventoryEventPayload): GoodsReceiptInventoryEventPayload {
  return {
    goodsReceiptId: input.goodsReceiptId,
    purchaseOrderId: input.purchaseOrderId,
    establishmentId: input.establishmentId,
    sourceRevision: input.sourceRevision,
    lines: input.lines.map((line) => ({ ...line })),
  };
}
