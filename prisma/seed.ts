import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const businessTypes = [
  { code: 'COMMERCE_DISTRIBUTION', name: 'Commerce & distribution', sortOrder: 10 },
  { code: 'SERVICES', name: 'Services', sortOrder: 20 },
  { code: 'CONSTRUCTION', name: 'Construction', sortOrder: 30 },
  { code: 'INDUSTRY', name: 'Industry', sortOrder: 40 },
  { code: 'PROFESSIONAL', name: 'Professional services', sortOrder: 50 },
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
