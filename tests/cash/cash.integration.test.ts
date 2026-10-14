import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import { exportPKCS8, exportSPKI } from 'jose';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';
import { CashAccountService } from '../../src/cash/cash-account.service.js';
import { CashMovementService } from '../../src/cash/cash-movement.service.js';
import { seedReferenceData } from '../../prisma/seed.js';

describe('Phase 7 Cash ledger', () => {
  let prisma: PrismaService;
  let accounts: CashAccountService;
  let movements: CashMovementService;
  let outbox: PrismaOutboxWriter;
  let organizationId: string;
  let otherOrganizationId: string;
  let establishmentId: string;
  let secondEstablishmentId: string;
  let accountId: string;
  let destinationAccountId: string;
  const actor = { userId: randomUUID(), sessionId: randomUUID() };
  const restrictedActor = { userId: randomUUID(), sessionId: randomUUID() };

  beforeAll(async () => {
    const { privateKey, publicKey } = await promisify(generateKeyPair)('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.JWT_ISSUER = 'phase7-cash-test';
    process.env.JWT_AUDIENCE = 'phase7-cash-api';
    process.env.JWT_KEY_ID = 'phase7-cash';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    accounts = moduleRef.get(CashAccountService);
    movements = moduleRef.get(CashMovementService);
    outbox = moduleRef.get(PrismaOutboxWriter);
    await seedReferenceData(prisma);

    const businessType = await prisma.businessType.findFirstOrThrow({ select: { code: true } });
    const business = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } }, include: { modules: true } });
    organizationId = randomUUID();
    establishmentId = randomUUID();
    secondEstablishmentId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, businessTypeCode: businessType.code, name: 'Cash tenant', handle: `cash-${Date.now()}`, defaultCurrency: 'EUR' } });
    await prisma.subscription.create({ data: { id: randomUUID(), organizationId, planVersionId: business.id, status: 'ACTIVE', startsAt: new Date() } });
    await prisma.organizationModuleActivation.createMany({ data: business.modules.map((module) => ({ id: randomUUID(), organizationId, moduleCode: module.moduleCode, enabled: true })) });
    await prisma.establishment.createMany({ data: [
      { id: establishmentId, organizationId, code: 'MAIN', name: 'Main', type: 'HEAD_OFFICE' },
      { id: secondEstablishmentId, organizationId, code: 'SECOND', name: 'Second', type: 'OFFICE' },
    ] });
    await prisma.user.createMany({ data: [
      { id: actor.userId, email: `cash-${actor.userId}@example.com`, normalizedEmail: `cash-${actor.userId}@example.com`, passwordHash: 'not-used', firstName: 'Cash', lastName: 'Owner' },
      { id: restrictedActor.userId, email: `cash-restricted-${restrictedActor.userId}@example.com`, normalizedEmail: `cash-restricted-${restrictedActor.userId}@example.com`, passwordHash: 'not-used', firstName: 'Cash', lastName: 'Restricted' },
    ] });
    await prisma.membership.create({ data: { id: randomUUID(), organizationId, userId: actor.userId, role: 'OWNER', scopeMode: 'ALL_ESTABLISHMENTS' } });
    const restrictedMembershipId = randomUUID();
    await prisma.membership.create({ data: { id: restrictedMembershipId, organizationId, userId: restrictedActor.userId, role: 'FINANCE', scopeMode: 'SELECTED_ESTABLISHMENTS' } });
    await prisma.membershipEstablishmentScope.create({ data: { membershipId: restrictedMembershipId, organizationId, establishmentId: secondEstablishmentId } });

    otherOrganizationId = randomUUID();
    await prisma.organization.create({ data: { id: otherOrganizationId, businessTypeCode: businessType.code, name: 'Other cash tenant', handle: `cash-other-${Date.now()}`, defaultCurrency: 'EUR' } });
    await prisma.subscription.create({ data: { id: randomUUID(), organizationId: otherOrganizationId, planVersionId: business.id, status: 'ACTIVE', startsAt: new Date() } });
    await prisma.organizationModuleActivation.createMany({ data: business.modules.map((module) => ({ id: randomUUID(), organizationId: otherOrganizationId, moduleCode: module.moduleCode, enabled: true })) });
    await prisma.establishment.create({ data: { id: randomUUID(), organizationId: otherOrganizationId, code: 'OTHER', name: 'Other', type: 'HEAD_OFFICE' } });

    const account = await accounts.create(actor, organizationId, { establishmentId, code: 'MAIN-CASH', name: 'Main cash', currency: 'EUR' }, 'cash-account-main');
    accountId = (account as { id: string }).id;
    const destination = await accounts.create(actor, organizationId, { establishmentId, code: 'BANK', name: 'Bank', currency: 'EUR' }, 'cash-account-bank');
    destinationAccountId = (destination as { id: string }).id;
  }, 60000);

  afterAll(async () => {
    if (!prisma) return;
    const organizationIds = [organizationId, otherOrganizationId].filter((id): id is string => Boolean(id));
    if (organizationIds.length) await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [actor.userId, restrictedActor.userId] } } });
    await prisma.$disconnect();
  });

  it('creates an active account with a derived zero balance and atomic audit/outbox', async () => {
    const account = await accounts.get(actor, organizationId, accountId);
    expect(account).toMatchObject({ id: accountId, organizationId, establishmentId, code: 'MAIN-CASH', currency: 'EUR', status: 'ACTIVE', balance: '0.0000' });
    await expect(prisma.auditEvent.count({ where: { organizationId, targetType: 'CashAccount', targetId: accountId, action: 'CASH_ACCOUNT_CREATED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId, aggregateType: 'CashAccount', aggregateId: accountId, eventType: 'cash.account.created' } })).resolves.toBe(1);
  });

  it('records a movement idempotently and derives the account balance', async () => {
    const input = { establishmentId, cashAccountId: accountId, direction: 'IN' as const, amount: '100.0000', occurredAt: '2026-10-14T10:00:00.000Z', reason: 'Opening cash' };
    const first = await movements.create(actor, organizationId, input, 'cash-opening');
    await expect(movements.create(actor, organizationId, input, 'cash-opening')).resolves.toEqual(first);
    await expect(movements.create(actor, organizationId, { ...input, amount: '101.0000' }, 'cash-opening')).rejects.toThrow(/idempotency/i);
    await expect(accounts.get(actor, organizationId, accountId)).resolves.toMatchObject({ balance: '100.0000' });
    await expect(prisma.cashMovement.count({ where: { organizationId, cashAccountId: accountId } })).resolves.toBe(1);
  });

  it('rejects insufficient outputs and compensates an immutable movement', async () => {
    await expect(movements.create(actor, organizationId, { establishmentId, cashAccountId: accountId, direction: 'OUT', amount: '101.0000', occurredAt: '2026-10-14T10:01:00.000Z', reason: 'Too much' }, 'cash-too-much')).rejects.toThrow(/insufficient|balance/i);
    const original = await prisma.cashMovement.findFirstOrThrow({ where: { organizationId, cashAccountId: accountId } });
    const correction = await movements.correct(actor, organizationId, original.id, { reason: 'Opening cash correction' }, 'cash-correction');
    expect(correction).toMatchObject({ correctedMovementId: original.id, direction: 'OUT', amount: '100.0000' });
    await expect(accounts.get(actor, organizationId, accountId)).resolves.toMatchObject({ balance: '0.0000' });
    await expect(prisma.cashMovement.update({ where: { id: original.id }, data: { reason: 'tampered' } })).rejects.toThrow();
  });

  it('transfers same-currency cash atomically and replays the pair', async () => {
    await movements.create(actor, organizationId, { establishmentId, cashAccountId: accountId, direction: 'IN', amount: '100.0000', occurredAt: '2026-10-14T10:01:30.000Z', reason: 'Transfer funding' }, 'cash-transfer-funding');
    const result = await movements.transfer(actor, organizationId, { establishmentId, sourceCashAccountId: accountId, destinationCashAccountId: destinationAccountId, amount: '25.0000', occurredAt: '2026-10-14T10:02:00.000Z', reason: 'Bank deposit' }, 'cash-transfer');
    expect(result).toMatchObject({ sourceCashAccountId: accountId, destinationCashAccountId: destinationAccountId, amount: '25.0000', currency: 'EUR' });
    await expect(movements.transfer(actor, organizationId, { establishmentId, sourceCashAccountId: accountId, destinationCashAccountId: destinationAccountId, amount: '25.0000', occurredAt: '2026-10-14T10:02:00.000Z', reason: 'Bank deposit' }, 'cash-transfer')).resolves.toEqual(result);
    await expect(prisma.cashMovement.count({ where: { organizationId, transferId: (result as { id: string }).id } })).resolves.toBe(2);
  });

  it('enforces tenant and selected-establishment isolation', async () => {
    await expect(accounts.get(actor, otherOrganizationId, accountId)).rejects.toThrow(/access denied|forbidden/i);
    await expect(movements.create(restrictedActor, organizationId, { establishmentId, cashAccountId: accountId, direction: 'IN', amount: '1.0000', occurredAt: '2026-10-14T10:03:00.000Z', reason: 'Out of scope' }, 'cash-out-of-scope')).rejects.toThrow(/establishment|scope|access/i);
    await expect(accounts.deactivate(actor, organizationId, accountId, { reason: 'Temporarily closed' }, 'cash-deactivate')).resolves.toMatchObject({ status: 'INACTIVE' });
    await expect(movements.create(actor, organizationId, { establishmentId, cashAccountId: accountId, direction: 'IN', amount: '1.0000', occurredAt: '2026-10-14T10:04:00.000Z', reason: 'Inactive account' }, 'cash-inactive')).rejects.toThrow(/inactive|active/i);
  });

  it('serializes concurrent outputs so only one can consume the balance', async () => {
    await accounts.reactivate(actor, organizationId, accountId, { reason: 'Reopened' }, 'cash-reactivate');
    const results = await Promise.allSettled([
      movements.create(actor, organizationId, { establishmentId, cashAccountId: accountId, direction: 'OUT', amount: '60.0000', occurredAt: '2026-10-14T10:05:00.000Z', reason: 'Concurrent withdrawal' }, 'cash-race-1'),
      movements.create(actor, organizationId, { establishmentId, cashAccountId: accountId, direction: 'OUT', amount: '60.0000', occurredAt: '2026-10-14T10:05:00.000Z', reason: 'Concurrent withdrawal' }, 'cash-race-2'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(accounts.get(actor, organizationId, accountId)).resolves.toMatchObject({ balance: '15.0000' });
  });

  it('rolls back the movement when the outbox cannot be written', async () => {
    const enqueue = vi.spyOn(outbox, 'enqueue').mockRejectedValueOnce(new Error('outbox unavailable'));
    const key = 'cash-rollback';
    await expect(movements.create(actor, organizationId, { establishmentId, cashAccountId: accountId, direction: 'IN', amount: '7.0000', occurredAt: '2026-10-14T10:06:00.000Z', reason: 'Rollback' }, key)).rejects.toThrow('outbox unavailable');
    enqueue.mockRestore();
    await expect(prisma.cashMovement.count({ where: { organizationId, idempotencyKey: key } })).resolves.toBe(0);
    await expect(accounts.get(actor, organizationId, accountId)).resolves.toMatchObject({ balance: '15.0000' });
  });
});
