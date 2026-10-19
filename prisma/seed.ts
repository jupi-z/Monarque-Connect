import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/monarque_connect";

const businessTypes = [
  {
    code: "COMMERCE_DISTRIBUTION",
    name: "Commerce & distribution",
    sortOrder: 10,
  },
  { code: "SERVICE_PROVIDER", name: "Service provider", sortOrder: 20 },
  { code: "MINING_SUPPLIER_B2B", name: "Mining supplier / B2B", sortOrder: 30 },
  { code: "SMALL_INDUSTRY", name: "Small industry", sortOrder: 40 },
  { code: "OTHER", name: "Other activity", sortOrder: 50 },
] as const;

const businessTypePresets = {
  COMMERCE_DISTRIBUTION: ['CATALOG', 'SALES', 'INVENTORY', 'CASH'],
  SERVICE_PROVIDER: ['CRM', 'PROJECTS', 'EXPENSES', 'DOCUMENTS'],
  MINING_SUPPLIER_B2B: ['CATALOG', 'PURCHASES', 'INVENTORY', 'EXPENSES'],
  SMALL_INDUSTRY: ['CATALOG', 'PURCHASES', 'INVENTORY', 'PROJECTS'],
  OTHER: ['CATALOG', 'CRM'],
} as const;

const modules = [
  ["AUTH", "Authentication", "Core", true, []],
  ["ORGANIZATION", "Organizations", "Core", true, []],
  ["ESTABLISHMENTS", "Establishments", "Core", true, []],
  ["MEMBERSHIPS", "Memberships", "Core", true, []],
  ["PLATFORM_SECURITY", "Platform security", "Core", true, []],
  ["DATA_PORTABILITY", "Data portability", "Core", true, []],
  ["CATALOG", "Catalog", "Business OS / Network", false, []],
  ["CRM", "CRM", "Business OS", false, []],
  ["SALES", "Sales", "Business OS", false, ["CATALOG"]],
  ["PURCHASES", "Purchases", "Business OS", false, ["CATALOG"]],
  ["INVENTORY", "Inventory", "Business OS", false, ["CATALOG"]],
  ["EXPENSES", "Expenses", "Business OS", false, []],
  ["CASH", "Cash", "Business OS", false, []],
  ["PROJECTS", "Projects", "Business OS", false, []],
  ["DOCUMENTS", "Documents", "Business OS", false, []],
  ["NETWORK_PROFILE", "Network profile", "Network", false, []],
  ["NETWORK_TRUST", "Network trust", "Network", false, ["NETWORK_PROFILE"]],
  ["NETWORK_DISCOVERY", "Network discovery", "Network", false, []],
  [
    "NETWORK_CONNECTIONS",
    "Network connections",
    "Network",
    false,
    ["NETWORK_DISCOVERY"],
  ],
  [
    "NETWORK_INQUIRIES",
    "Network inquiries",
    "Network",
    false,
    ["NETWORK_PROFILE"],
  ],
  ["MESSAGING", "Messaging", "Network", false, ["NETWORK_CONNECTIONS"]],
  ["INTELLIGENCE_BASIC", "Basic intelligence", "Intelligence", false, []],
] as const;

const connectModules = [
  "NETWORK_PROFILE",
  "NETWORK_TRUST",
  "NETWORK_DISCOVERY",
  "NETWORK_CONNECTIONS",
  "NETWORK_INQUIRIES",
  "MESSAGING",
  "CATALOG",
];
const operationsModules = [
  ...connectModules,
  "CRM",
  "SALES",
  "EXPENSES",
  "DOCUMENTS",
  "INTELLIGENCE_BASIC",
];
const businessModules = [
  ...operationsModules,
  "PURCHASES",
  "INVENTORY",
  "CASH",
  "PROJECTS",
];
const plans = [
  {
    code: "CONNECT",
    name: "Connect",
    description: "Visibility, catalog and opportunities.",
    modules: connectModules,
    maxUsers: 5,
    maxEstablishments: 1,
  },
  {
    code: "OPERATIONS",
    name: "Operations",
    description: "Connect plus daily operational workflows.",
    modules: operationsModules,
    maxUsers: 15,
    maxEstablishments: 3,
  },
  {
    code: "BUSINESS",
    name: "Business",
    description: "Operations plus purchasing, inventory, cash and projects.",
    modules: businessModules,
    maxUsers: 50,
    maxEstablishments: 10,
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    description: "All MVP modules with configurable governance.",
    modules: businessModules,
    maxUsers: 500,
    maxEstablishments: 100,
  },
] as const;

const fairScalePriceVersions = [
  { planCode: "CONNECT", billingPeriod: "MONTHLY", baseAmountMinor: 0n, welcomeAmountMinor: 0n, annualDiscountAmountMinor: 0n, includedEstablishments: 1 },
  { planCode: "CONNECT", billingPeriod: "YEARLY", baseAmountMinor: 0n, welcomeAmountMinor: 0n, annualDiscountAmountMinor: 0n, includedEstablishments: 1 },
  { planCode: "OPERATIONS", billingPeriod: "MONTHLY", baseAmountMinor: 1500n, welcomeAmountMinor: 1275n, annualDiscountAmountMinor: 0n, includedEstablishments: 1 },
  { planCode: "OPERATIONS", billingPeriod: "YEARLY", baseAmountMinor: 18000n, welcomeAmountMinor: 14400n, annualDiscountAmountMinor: 3600n, includedEstablishments: 1 },
  { planCode: "BUSINESS", billingPeriod: "MONTHLY", baseAmountMinor: 4500n, welcomeAmountMinor: 3825n, annualDiscountAmountMinor: 0n, includedEstablishments: 3 },
  { planCode: "BUSINESS", billingPeriod: "YEARLY", baseAmountMinor: 54000n, welcomeAmountMinor: 43200n, annualDiscountAmountMinor: 10800n, includedEstablishments: 3 },
  { planCode: "ENTERPRISE", billingPeriod: "MONTHLY", baseAmountMinor: 18000n, welcomeAmountMinor: 15300n, annualDiscountAmountMinor: 0n, includedEstablishments: 10 },
  { planCode: "ENTERPRISE", billingPeriod: "YEARLY", baseAmountMinor: 216000n, welcomeAmountMinor: 172800n, annualDiscountAmountMinor: 43200n, includedEstablishments: 10 },
] as const;

const fairScaleCatalogPublishedAt = new Date("2026-10-19T00:00:00.000Z");

async function seedReferenceDataOnce(prisma: PrismaClient): Promise<void> {
  for (const businessType of businessTypes) {
    await prisma.businessType.upsert({
      where: { code: businessType.code },
      update: {
        name: businessType.name,
        sortOrder: businessType.sortOrder,
        active: true,
      },
      create: businessType,
    });
  }
  for (const [code, displayName, pillar, isCore, dependencies] of modules) {
    await prisma.moduleCatalog.upsert({
      where: { code },
      update: {
        displayName,
        pillar,
        isCore,
        availability: "MVP",
        dependenciesJson: dependencies,
      },
      create: {
        code,
        displayName,
        pillar,
        isCore,
        availability: "MVP",
        dependenciesJson: dependencies,
      },
    });
  }
  for (const [businessTypeCode, moduleCodes] of Object.entries(businessTypePresets)) {
    for (const moduleCode of moduleCodes) {
      await prisma.moduleBusinessTypePreset.upsert({
        where: { businessTypeCode_moduleCode: { businessTypeCode, moduleCode } },
        update: { recommended: true, defaultEnabled: true },
        create: { businessTypeCode, moduleCode, recommended: true, defaultEnabled: true },
      });
    }
  }
  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: { name: plan.name, description: plan.description },
      create: {
        code: plan.code,
        name: plan.name,
        description: plan.description,
      },
    });
    const planVersion = await prisma.planVersion.upsert({
      where: { planCode_version: { planCode: plan.code, version: 1 } },
      update: {},
      create: {
        id: crypto.randomUUID(),
        planCode: plan.code,
        version: 1,
        status: "ACTIVE",
        currency: "EUR",
        billingPeriod: "MONTHLY",
        publishedAt: new Date("2026-10-11T00:00:00.000Z"),
      },
    });
    for (const moduleCode of plan.modules) {
      await prisma.planVersionModule.upsert({
        where: {
          planVersionId_moduleCode: {
            planVersionId: planVersion.id,
            moduleCode,
          },
        },
        update: {},
        create: {
          planVersionId: planVersion.id,
          moduleCode,
          defaultEnabled: true,
        },
      });
    }
    for (const [quotaCode, limitValue] of [
      ["MAX_USERS", plan.maxUsers],
      ["MAX_ESTABLISHMENTS", plan.maxEstablishments],
    ] as const) {
      await prisma.planVersionQuota.upsert({
        where: {
          planVersionId_quotaCode: { planVersionId: planVersion.id, quotaCode },
        },
        update: {},
        create: {
          id: crypto.randomUUID(),
          planVersionId: planVersion.id,
          quotaCode,
          unit: "COUNT",
          mode: "CAPACITY",
          limitValue,
        },
      });
    }

    for (const price of fairScalePriceVersions.filter(({ planCode }) => planCode === plan.code)) {
      const priceVersion = await prisma.priceVersion.upsert({
        where: {
          planCode_version_billingPeriod: {
            planCode: price.planCode,
            version: 1,
            billingPeriod: price.billingPeriod,
          },
        },
        update: {
          currency: "USD",
          status: "ACTIVE",
          baseAmountMinor: price.baseAmountMinor,
          welcomeAmountMinor: price.welcomeAmountMinor,
          annualDiscountAmountMinor: price.annualDiscountAmountMinor,
          includedEstablishments: price.includedEstablishments,
          publishedAt: fairScaleCatalogPublishedAt,
        },
        create: {
          id: crypto.randomUUID(),
          planCode: price.planCode,
          version: 1,
          billingPeriod: price.billingPeriod,
          currency: "USD",
          status: "ACTIVE",
          baseAmountMinor: price.baseAmountMinor,
          welcomeAmountMinor: price.welcomeAmountMinor,
          annualDiscountAmountMinor: price.annualDiscountAmountMinor,
          includedEstablishments: price.includedEstablishments,
          startsAt: fairScaleCatalogPublishedAt,
          publishedAt: fairScaleCatalogPublishedAt,
        },
      });

      if (price.planCode !== "CONNECT") {
        const addonAmountMinor = price.billingPeriod === "MONTHLY" ? 1000n : 12000n;
        await prisma.priceComponent.upsert({
          where: {
            priceVersionId_code: {
              priceVersionId: priceVersion.id,
              code: "ESTABLISHMENT",
            },
          },
          update: {
            kind: "ESTABLISHMENT_ADDON",
            currency: "USD",
            amountMinor: addonAmountMinor,
            capacityUnits: 1,
          },
          create: {
            id: crypto.randomUUID(),
            priceVersionId: priceVersion.id,
            code: "ESTABLISHMENT",
            kind: "ESTABLISHMENT_ADDON",
            currency: "USD",
            amountMinor: addonAmountMinor,
            capacityUnits: 1,
          },
        });
      }
    }
  }
}

export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await seedReferenceDataOnce(prisma);
      return;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002" || attempt === 3) throw error;
    }
  }
}

export async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    await seedReferenceData(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`)
  await main();
