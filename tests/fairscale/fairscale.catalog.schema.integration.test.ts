import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createTestPool } from '../events/test-database.js';
import { seedReferenceData } from '../../prisma/seed.js';

type PriceRow = {
  plan_code: string;
  billing_period: 'MONTHLY' | 'YEARLY';
  currency: string;
  base_amount_minor: bigint;
  welcome_amount_minor: bigint;
  annual_discount_amount_minor: bigint;
  included_establishments: number;
  status: string;
};

describe('FairScale Phase 9.5 catalog schema', () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  beforeAll(async () => prisma.$connect());

  beforeEach(async () => {
    const pool = createTestPool();
    await pool.query('TRUNCATE TABLE billing_promotion_redemptions, billing_promotion_eligibilities, billing_quote_lines, billing_quotes, billing_customer_organizations, billing_customers, price_components, price_versions RESTART IDENTITY CASCADE');
    await pool.end();
  });

  afterAll(async () => prisma.$disconnect());

  it('seeds immutable USD price versions without changing historical EUR plan versions', async () => {
    await seedReferenceData(prisma);
    await seedReferenceData(prisma);

    const prices = await prisma.$queryRaw<PriceRow[]>`
      SELECT plan_code, billing_period, currency, base_amount_minor, welcome_amount_minor,
             annual_discount_amount_minor, included_establishments, status
      FROM price_versions
      ORDER BY plan_code, billing_period
    `;

    expect(prices).toHaveLength(8);
    expect(prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ plan_code: 'OPERATIONS', billing_period: 'MONTHLY', currency: 'USD', base_amount_minor: 1500n, welcome_amount_minor: 1275n, annual_discount_amount_minor: 0n, included_establishments: 1, status: 'ACTIVE' }),
      expect.objectContaining({ plan_code: 'BUSINESS', billing_period: 'MONTHLY', currency: 'USD', base_amount_minor: 4500n, welcome_amount_minor: 3825n, annual_discount_amount_minor: 0n, included_establishments: 3, status: 'ACTIVE' }),
      expect.objectContaining({ plan_code: 'ENTERPRISE', billing_period: 'MONTHLY', currency: 'USD', base_amount_minor: 18000n, welcome_amount_minor: 15300n, annual_discount_amount_minor: 0n, included_establishments: 10, status: 'ACTIVE' }),
      expect.objectContaining({ plan_code: 'BUSINESS', billing_period: 'YEARLY', currency: 'USD', base_amount_minor: 54000n, welcome_amount_minor: 43200n, annual_discount_amount_minor: 10800n, included_establishments: 3, status: 'ACTIVE' }),
    ]));

    const historical = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM plan_versions WHERE currency = 'EUR'`;
    expect(historical[0]?.count).toBe(4n);
  });

  it('publishes an establishment add-on for both billing cycles', async () => {
    await seedReferenceData(prisma);
    const addons = await prisma.$queryRaw<Array<{ billing_period: string; amount_minor: bigint; capacity_units: number }>>`
      SELECT pv.billing_period, pc.amount_minor, pc.capacity_units
      FROM price_components pc
      JOIN price_versions pv ON pv.id = pc.price_version_id
      WHERE pc.code = 'ESTABLISHMENT' AND pv.plan_code = 'BUSINESS'
      ORDER BY pv.billing_period
    `;
    expect(addons).toEqual([
      { billing_period: 'MONTHLY', amount_minor: 1000n, capacity_units: 1 },
      { billing_period: 'YEARLY', amount_minor: 12000n, capacity_units: 1 },
    ]);
  });
});
