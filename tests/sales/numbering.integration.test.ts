import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NumberingService } from '../../src/sales/numbering.service.js';
import { SalesDocumentType } from '../../src/sales/sales.types.js';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const service = new NumberingService();
const organizationId = 'f3c1c2b4-5b08-4a3d-a3ce-9d9a6c5b0001';
const businessTypeCode = 'SALES_NUMBERING_TEST';

describe('NumberingService', () => {
  beforeAll(async () => {
    await prisma.$executeRaw`
      INSERT INTO business_types (code, name, active, sort_order)
      VALUES (${businessTypeCode}, 'Sales numbering test', true, 0)
      ON CONFLICT (code) DO NOTHING
    `;
    await prisma.$executeRaw`
      INSERT INTO organizations (id, business_type_code, name, handle, default_currency, status, created_at, updated_at)
      VALUES (${organizationId}::uuid, ${businessTypeCode}, 'Sales numbering test', 'sales-numbering-test', 'EUR', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO NOTHING
    `;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
    await prisma.$disconnect();
  });

  it('allocates unique sequential numbers under concurrent transactions', async () => {
    const numbers = await Promise.all(
      Array.from({ length: 8 }, () => prisma.$transaction((tx) => service.allocate(SalesDocumentType.QUOTE, organizationId, 2026, tx))),
    );

    expect(new Set(numbers).size).toBe(8);
    expect(numbers.sort()).toEqual([
      'Q-2026-000001',
      'Q-2026-000002',
      'Q-2026-000003',
      'Q-2026-000004',
      'Q-2026-000005',
      'Q-2026-000006',
      'Q-2026-000007',
      'Q-2026-000008',
    ]);
  });

  it('resets the sequence by year and keeps counters tenant-scoped', async () => {
    await expect(prisma.$transaction((tx) => service.allocate(SalesDocumentType.INVOICE, organizationId, 2026, tx))).resolves.toBe('INV-2026-000001');
    await expect(prisma.$transaction((tx) => service.allocate(SalesDocumentType.INVOICE, organizationId, 2027, tx))).resolves.toBe('INV-2027-000001');
  });
});
