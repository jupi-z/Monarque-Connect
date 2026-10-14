import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import { exportPKCS8, exportSPKI } from 'jose';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';
import { ExpenseService } from '../../src/expenses/expense.service.js';
import { seedReferenceData } from '../../prisma/seed.js';

describe('Phase 7 Expenses', () => {
  let prisma: PrismaService;
  let expenses: ExpenseService;
  let outbox: PrismaOutboxWriter;
  let organizationId: string;
  let otherOrganizationId: string;
  let establishmentId: string;
  let restrictedEstablishmentId: string;
  let partyId: string;
  let otherPartyId: string;
  const actor = { userId: randomUUID(), sessionId: randomUUID() };
  const restrictedActor = { userId: randomUUID(), sessionId: randomUUID() };

  beforeAll(async () => {
    const { privateKey, publicKey } = await promisify(generateKeyPair)('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.JWT_ISSUER = 'phase7-expenses-test';
    process.env.JWT_AUDIENCE = 'phase7-expenses-api';
    process.env.JWT_KEY_ID = 'phase7-expenses';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    expenses = moduleRef.get(ExpenseService);
    outbox = moduleRef.get(PrismaOutboxWriter);
    await seedReferenceData(prisma);

    const businessType = await prisma.businessType.findFirstOrThrow({ select: { code: true } });
    const operations = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'OPERATIONS', version: 1 } }, include: { modules: true } });
    organizationId = randomUUID();
    establishmentId = randomUUID();
    restrictedEstablishmentId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, businessTypeCode: businessType.code, name: 'Expenses tenant', handle: `expenses-${Date.now()}`, defaultCurrency: 'EUR' } });
    await prisma.subscription.create({ data: { id: randomUUID(), organizationId, planVersionId: operations.id, status: 'ACTIVE', startsAt: new Date() } });
    await prisma.organizationModuleActivation.createMany({ data: operations.modules.map((module) => ({ id: randomUUID(), organizationId, moduleCode: module.moduleCode, enabled: true })) });
    await prisma.establishment.createMany({ data: [
      { id: establishmentId, organizationId, code: 'MAIN', name: 'Main', type: 'HEAD_OFFICE' },
      { id: restrictedEstablishmentId, organizationId, code: 'SECOND', name: 'Second', type: 'OFFICE' },
    ] });
    partyId = randomUUID();
    await prisma.businessParty.create({ data: { id: partyId, organizationId, type: 'SUPPLIER', displayName: 'Tenant supplier' } });
    await prisma.user.create({ data: { id: actor.userId, email: `expenses-${actor.userId}@example.com`, normalizedEmail: `expenses-${actor.userId}@example.com`, passwordHash: 'not-used', firstName: 'Expense', lastName: 'Owner' } });
    await prisma.membership.create({ data: { id: randomUUID(), organizationId, userId: actor.userId, role: 'OWNER', scopeMode: 'ALL_ESTABLISHMENTS' } });
    await prisma.user.create({ data: { id: restrictedActor.userId, email: `expenses-restricted-${restrictedActor.userId}@example.com`, normalizedEmail: `expenses-restricted-${restrictedActor.userId}@example.com`, passwordHash: 'not-used', firstName: 'Expense', lastName: 'Restricted' } });
    const restrictedMembershipId = randomUUID();
    await prisma.membership.create({ data: { id: restrictedMembershipId, organizationId, userId: restrictedActor.userId, role: 'FINANCE', scopeMode: 'SELECTED_ESTABLISHMENTS' } });
    await prisma.membershipEstablishmentScope.create({ data: { membershipId: restrictedMembershipId, organizationId, establishmentId: restrictedEstablishmentId } });

    otherOrganizationId = randomUUID();
    await prisma.organization.create({ data: { id: otherOrganizationId, businessTypeCode: businessType.code, name: 'Other tenant', handle: `expenses-other-${Date.now()}`, defaultCurrency: 'EUR' } });
    otherPartyId = randomUUID();
    await prisma.businessParty.create({ data: { id: otherPartyId, organizationId: otherOrganizationId, type: 'SUPPLIER', displayName: 'Other supplier' } });
  }, 60000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.organization.deleteMany({ where: { id: otherOrganizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [actor.userId, restrictedActor.userId] } } });
    await prisma.$disconnect();
  });

  const input = (overrides: Record<string, unknown> = {}) => ({
    establishmentId,
    description: 'Office supplies',
    category: 'SUPPLIES',
    amount: '12.3400',
    currency: 'EUR',
    expenseDate: '2026-10-14',
    ...overrides,
  });

  it('creates a draft with a tenant-qualified party and atomic audit/outbox', async () => {
    const created = await expenses.create(actor, organizationId, { ...input(), partyId }, 'expense-create-1');
    expect(created).toMatchObject({ organizationId, establishmentId, status: 'DRAFT', amount: '12.3400', currency: 'EUR', partyId });
    const row = created as { id: string };
    await expect(prisma.auditEvent.count({ where: { organizationId, targetType: 'Expense', targetId: row.id, action: 'EXPENSE_CREATED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId, aggregateType: 'Expense', aggregateId: row.id, eventType: 'expenses.created' } })).resolves.toBe(1);
  });

  it('replays the same create command and rejects a payload mismatch', async () => {
    const first = await expenses.create(actor, organizationId, { ...input(), description: 'Idempotent expense' }, 'expense-create-replay');
    await expect(expenses.create(actor, organizationId, { ...input(), description: 'Idempotent expense' }, 'expense-create-replay')).resolves.toEqual(first);
    await expect(expenses.create(actor, organizationId, { ...input(), description: 'Different payload' }, 'expense-create-replay')).rejects.toThrow(/idempotency/i);
  });

  it('records exactly once, makes recorded fields immutable, and voids with a reason', async () => {
    const created = await expenses.create(actor, organizationId, { ...input(), description: 'Lifecycle expense' }, 'expense-lifecycle-create') as { id: string; status: string };
    const recorded = await expenses.record(actor, organizationId, created.id, {}, 'expense-lifecycle-record') as { id: string; status: string };
    expect(recorded).toMatchObject({ id: created.id, status: 'RECORDED' });
    await expect(expenses.update(actor, organizationId, created.id, { description: 'Should fail' }, 'expense-lifecycle-update')).rejects.toThrow(/recorded|immutable|transition/i);
    await expect(expenses.void(actor, organizationId, created.id, { reason: 'Duplicate entry' }, 'expense-lifecycle-void')).resolves.toMatchObject({ id: created.id, status: 'VOID', voidReason: 'Duplicate entry' });
    await expect(expenses.void(actor, organizationId, created.id, { reason: 'Again' }, 'expense-lifecycle-void-replay')).rejects.toThrow(/terminal|void/i);
  });

  it('enforces tenant and establishment scope isolation and rejects a foreign party', async () => {
    await expect(expenses.create(actor, organizationId, { ...input(), partyId: otherPartyId }, 'expense-foreign-party')).rejects.toThrow(/party|tenant|not found/i);
    await expect(expenses.list(actor, otherOrganizationId, {})).rejects.toThrow(/access denied|forbidden/i);
    await expect(expenses.create(restrictedActor, organizationId, { ...input(), description: 'Out of scope' }, 'expense-out-of-scope')).rejects.toThrow(/establishment|scope/i);
    await expect(expenses.create(restrictedActor, organizationId, { ...input({ establishmentId: restrictedEstablishmentId }), description: 'In scope' }, 'expense-in-scope')).resolves.toMatchObject({ establishmentId: restrictedEstablishmentId });
  });

  it('rolls back the expense when the outbox cannot be written', async () => {
    const enqueue = vi.spyOn(outbox, 'enqueue').mockRejectedValueOnce(new Error('outbox unavailable'));
    const idempotencyKey = 'expense-rollback';
    const description = `Rollback ${randomUUID()}`;
    await expect(expenses.create(actor, organizationId, input({ description }), idempotencyKey)).rejects.toThrow('outbox unavailable');
    enqueue.mockRestore();
    await expect(prisma.expense.count({ where: { organizationId, description } })).resolves.toBe(0);
    await expect(prisma.expenseIdempotencyKey.count({ where: { organizationId, key: idempotencyKey } })).resolves.toBe(0);
  });
});
