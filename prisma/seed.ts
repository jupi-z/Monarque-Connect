import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

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

export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
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
    const existingVersion = await prisma.planVersion.findUnique({
      where: { planCode_version: { planCode: plan.code, version: 1 } },
    });
    const planVersion =
      existingVersion ??
      (await prisma.planVersion.create({
        data: {
          id: crypto.randomUUID(),
          planCode: plan.code,
          version: 1,
          status: "ACTIVE",
          currency: "EUR",
          billingPeriod: "MONTHLY",
          publishedAt: new Date("2026-10-11T00:00:00.000Z"),
        },
      }));
    for (const moduleCode of plan.modules) {
      const existingModule = await prisma.planVersionModule.findUnique({
        where: {
          planVersionId_moduleCode: {
            planVersionId: planVersion.id,
            moduleCode,
          },
        },
      });
      if (!existingModule)
        await prisma.planVersionModule.create({
          data: {
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
      const existingQuota = await prisma.planVersionQuota.findUnique({
        where: {
          planVersionId_quotaCode: { planVersionId: planVersion.id, quotaCode },
        },
      });
      if (!existingQuota)
        await prisma.planVersionQuota.create({
          data: {
            id: crypto.randomUUID(),
            planVersionId: planVersion.id,
            quotaCode,
            unit: "COUNT",
            limitValue,
          },
        });
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
