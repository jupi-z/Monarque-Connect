import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const businessTypes = [
  { code: 'COMMERCE_DISTRIBUTION', name: 'Commerce & distribution', sortOrder: 10 },
  { code: 'SERVICE_PROVIDER', name: 'Service provider', sortOrder: 20 },
  { code: 'MINING_SUPPLIER_B2B', name: 'Mining supplier / B2B', sortOrder: 30 },
  { code: 'SMALL_INDUSTRY', name: 'Small industry', sortOrder: 40 },
  { code: 'OTHER', name: 'Other activity', sortOrder: 50 },
] as const;

try {
  for (const businessType of businessTypes) {
    await prisma.businessType.upsert({
      where: { code: businessType.code },
      update: { name: businessType.name, sortOrder: businessType.sortOrder, active: true },
      create: businessType,
    });
  }
} finally {
  await prisma.$disconnect();
}
