import { describe, expect, it } from 'vitest';
import {
  buildGoodsReceiptConfirmedPayload,
  buildGoodsReceiptCorrectedPayload,
} from '../../src/purchases/goods-receipt.events.js';

describe('GoodsReceipt inventory event payloads', () => {
  it('publishes immutable line facts for a confirmed receipt', () => {
    expect(buildGoodsReceiptConfirmedPayload({
      goodsReceiptId: '8f8fad5b-d9cb-469f-a165-70867728950e',
      purchaseOrderId: '9f8fad5b-d9cb-469f-a165-70867728950e',
      establishmentId: 'af8fad5b-d9cb-469f-a165-70867728950e',
      lines: [{
        goodsReceiptLineId: 'bf8fad5b-d9cb-469f-a165-70867728950e',
        itemId: 'cf8fad5b-d9cb-469f-a165-70867728950e',
        quantity: '2.500000',
      }],
    })).toEqual({
      goodsReceiptId: '8f8fad5b-d9cb-469f-a165-70867728950e',
      purchaseOrderId: '9f8fad5b-d9cb-469f-a165-70867728950e',
      establishmentId: 'af8fad5b-d9cb-469f-a165-70867728950e',
      sourceRevision: 'CONFIRMED',
      lines: [{
        goodsReceiptLineId: 'bf8fad5b-d9cb-469f-a165-70867728950e',
        itemId: 'cf8fad5b-d9cb-469f-a165-70867728950e',
        deltaQuantity: '2.500000',
      }],
    });
  });

  it('publishes signed compensating deltas for a correction', () => {
    expect(buildGoodsReceiptCorrectedPayload({
      goodsReceiptId: '8f8fad5b-d9cb-469f-a165-70867728950e',
      purchaseOrderId: '9f8fad5b-d9cb-469f-a165-70867728950e',
      establishmentId: 'af8fad5b-d9cb-469f-a165-70867728950e',
      sourceRevision: 'correction-1',
      lines: [{
        goodsReceiptLineId: 'bf8fad5b-d9cb-469f-a165-70867728950e',
        itemId: 'cf8fad5b-d9cb-469f-a165-70867728950e',
        deltaQuantity: '-0.500000',
      }],
    })).toMatchObject({
      goodsReceiptId: '8f8fad5b-d9cb-469f-a165-70867728950e',
      sourceRevision: 'correction-1',
      lines: [{ deltaQuantity: '-0.500000' }],
    });
  });
});
