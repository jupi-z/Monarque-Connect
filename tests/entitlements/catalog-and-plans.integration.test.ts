import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createTestPool } from "../events/test-database.js";
import { seedReferenceData } from "../../prisma/seed.js";

describe("Product entitlements catalog and plan reference data", () => {
  const connectionString =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/monarque_connect_test";
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    const pool = createTestPool();
    await pool.query(
      "TRUNCATE TABLE plan_version_quotas, plan_version_modules, plan_versions, plans, module_catalog RESTART IDENTITY CASCADE",
    );
    await pool.end();
  });

  afterAll(async () => prisma.$disconnect());

  it("seeds the canonical catalog and plan versions idempotently", async () => {
    await seedReferenceData(prisma);
    await seedReferenceData(prisma);

    await expect(prisma.moduleCatalog.count()).resolves.toBe(22);
    await expect(prisma.plan.count()).resolves.toBe(4);
    await expect(prisma.planVersion.count()).resolves.toBe(4);
    await expect(prisma.planVersionModule.count()).resolves.toBeGreaterThan(0);

    const connect = await prisma.planVersion.findUnique({
      where: { planCode_version: { planCode: "CONNECT", version: 1 } },
      include: { modules: true, quotas: true },
    });
    expect(connect).toMatchObject({
      status: "ACTIVE",
      currency: "EUR",
      billingPeriod: "MONTHLY",
    });
    expect(connect?.modules.map((module) => module.moduleCode)).toEqual(
      expect.arrayContaining(["CATALOG", "NETWORK_PROFILE", "MESSAGING"]),
    );
    expect(connect?.quotas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ quotaCode: "MAX_USERS", limitValue: 5n }),
      ]),
    );
  });

  it("keeps published plan versions immutable by requiring a new version", async () => {
    await seedReferenceData(prisma);
    const original = await prisma.planVersion.findUniqueOrThrow({
      where: { planCode_version: { planCode: "CONNECT", version: 1 } },
    });

    await expect(
      prisma.planVersion.update({
        where: { id: original.id },
        data: { version: 2 },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.planVersion.create({
        data: {
          id: crypto.randomUUID(),
          planCode: original.planCode,
          version: 2,
          status: "DRAFT",
          currency: original.currency,
          billingPeriod: original.billingPeriod,
        },
      }),
    ).resolves.toMatchObject({
      planCode: "CONNECT",
      version: 2,
      status: "DRAFT",
    });
  });
});
