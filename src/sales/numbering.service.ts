import { Prisma } from '@prisma/client';
import { SalesDocumentType } from './sales.types.js';

const PREFIXES: Record<SalesDocumentType, string> = {
  [SalesDocumentType.QUOTE]: 'Q',
  [SalesDocumentType.SALES_ORDER]: 'SO',
  [SalesDocumentType.INVOICE]: 'INV',
};

export class NumberingService {
  async allocate(
    type: SalesDocumentType,
    organizationId: string,
    year: number,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    if (!Number.isInteger(year) || year < 1 || year > 9999) {
      throw new Error('Year must be an integer between 1 and 9999');
    }

    const rows = await tx.$queryRaw<Array<{ last_value: number }>>(Prisma.sql`
      INSERT INTO sales_number_counters (
        id, organization_id, document_type, year, last_value, created_at, updated_at
      )
      VALUES (
        gen_random_uuid(), ${organizationId}::uuid, ${type}::"SalesDocumentType", ${year}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (organization_id, document_type, year)
      DO UPDATE SET last_value = sales_number_counters.last_value + 1, updated_at = CURRENT_TIMESTAMP
      RETURNING last_value
    `);

    const value = rows[0]?.last_value;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new Error('Sales number allocation returned an invalid counter value');
    }

    return `${PREFIXES[type]}-${String(year).padStart(4, '0')}-${String(value).padStart(6, '0')}`;
  }
}
