import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import { exportPKCS8, exportSPKI } from 'jose';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../../src/auth/auth.service.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { LoginRateLimiter } from '../../src/auth/login-rate-limiter.service.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';
import { OrganizationService } from '../../src/tenancy/organization.service.js';
import { EffectiveEntitlementsService } from '../../src/entitlements/effective-entitlements.service.js';
import { SubscriptionService } from '../../src/entitlements/subscription.service.js';
import { QuotaService } from '../../src/entitlements/quota.service.js';
import { AuthorizationService } from '../../src/tenancy/authorization.service.js';
import { InvitationService } from '../../src/tenancy/invitation.service.js';
import { seedReferenceData } from '../../prisma/seed.js';
import { createTestPool } from '../events/test-database.js';

const generateKeyPairAsync = promisify(generateKeyPair);

describe('Identity and tenancy integration', () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const outbox = new PrismaOutboxWriter();
  let auth: AuthService;
  let organizations: OrganizationService;
  let ownerId = '';
  let secondUserId = '';
  let invitations: InvitationService;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const config = new ConfigService({
      JWT_ISSUER: 'monarque-connect-test', JWT_AUDIENCE: 'monarque-connect-api-test', JWT_KEY_ID: 'test-key-1',
      JWT_PRIVATE_KEY_PEM: await exportPKCS8(privateKey), JWT_PUBLIC_KEY_PEM: await exportSPKI(publicKey),
    });
    const password = new PasswordService();
    const token = new TokenService(config);
    const prismaService = prisma as never;
    const subscriptions = new SubscriptionService(prismaService, outbox);
    const entitlements = new EffectiveEntitlementsService(prismaService, subscriptions);
    const authorization = new AuthorizationService(prismaService, entitlements);
    auth = new AuthService(prismaService, password, token, outbox, new LoginRateLimiter(prismaService));
    const quotas = new QuotaService(prismaService, subscriptions, outbox);
    organizations = new OrganizationService(prismaService, authorization, outbox, entitlements, quotas, subscriptions);
    invitations = new InvitationService(prismaService, authorization, outbox, quotas);
    await prisma.$connect();
  });

  beforeEach(async () => {
    const pool = createTestPool();
    await pool.query('TRUNCATE TABLE audit_events, membership_establishment_scopes, invitations, memberships, establishments, organizations, business_types, refresh_sessions, users, event_consumer_receipts, outbox_events RESTART IDENTITY CASCADE');
    await pool.end();
    await prisma.businessType.create({ data: { code: 'COMMERCE_DISTRIBUTION', name: 'Commerce & distribution', sortOrder: 10 } });
    await seedReferenceData(prisma);
  });

  afterAll(async () => prisma.$disconnect());

  it('registers, logs in, rotates refresh sessions, and returns the current user', async () => {
    const registered = await auth.register({ email: 'owner@example.com', password: 'correct horse battery staple', firstName: 'Owner', lastName: 'One' });
    ownerId = registered.id;
    const tokens = await auth.login({ identifier: 'OWNER@EXAMPLE.COM', password: 'correct horse battery staple' });
    const rotated = await auth.refresh({ refreshToken: tokens.refreshToken });
    await expect(auth.me({ userId: ownerId, sessionId: rotated.sessionId })).resolves.toMatchObject({ email: 'owner@example.com' });
    await expect(auth.refresh({ refreshToken: tokens.refreshToken })).rejects.toThrow();
    await expect(prisma.refreshSession.count({ where: { userId: ownerId, revokedAt: { not: null } } })).resolves.toBeGreaterThan(0);
  });

  it('creates the primary establishment atomically and denies another tenant', async () => {
    const owner = await auth.register({ email: 'owner2@example.com', password: 'correct horse battery staple', firstName: 'Owner', lastName: 'Two' });
    const second = await auth.register({ email: 'other@example.com', password: 'correct horse battery staple', firstName: 'Other', lastName: 'User' });
    ownerId = owner.id;
    secondUserId = second.id;
    const created = await organizations.create({ userId: ownerId, sessionId: '00000000-0000-0000-0000-000000000001' }, {
      businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Tenant A', handle: 'tenant-a', defaultCurrency: 'EUR', establishmentName: 'Head office',
    }) as { id: string; establishment: { isPrimary: boolean } };
    expect(created.establishment.isPrimary).toBe(true);
    await expect(organizations.list({ userId: secondUserId, sessionId: '00000000-0000-0000-0000-000000000002' })).resolves.toHaveLength(0);
    await expect(organizations.get({ userId: secondUserId, sessionId: '00000000-0000-0000-0000-000000000002' }, created.id)).rejects.toThrow();
    await expect(prisma.establishment.count({ where: { organizationId: created.id, isPrimary: true } })).resolves.toBe(1);
  });

  it('accepts a hashed, single-use invitation with a selected establishment scope', async () => {
    const owner = await auth.register({ email: 'owner3@example.com', password: 'correct horse battery staple', firstName: 'Owner', lastName: 'Three' });
    const invited = await auth.register({ email: 'member@example.com', password: 'correct horse battery staple', firstName: 'Member', lastName: 'User' });
    const requestedEnterprise = {
      businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Tenant C', handle: 'tenant-c', defaultCurrency: 'EUR', establishmentName: 'Head office', planCode: 'ENTERPRISE',
    } as unknown as Parameters<typeof organizations.create>[1];
    const created = await organizations.create({ userId: owner.id, sessionId: '00000000-0000-0000-0000-000000000003' }, requestedEnterprise) as { id: string; planCode: string; establishment: { id: string } };
    expect(created.planCode).toBe('CONNECT');
    await expect(prisma.subscription.findFirst({ where: { organizationId: created.id }, include: { planVersion: true } })).resolves.toMatchObject({ planVersion: { planCode: 'CONNECT' } });
    const secondEstablishment = { id: crypto.randomUUID() };
    const invitation = await invitations.create({ userId: owner.id, sessionId: '00000000-0000-0000-0000-000000000003' }, created.id, { email: 'member@example.com', role: 'VIEWER', scopeMode: 'SELECTED_ESTABLISHMENTS', establishmentIds: [created.establishment.id] }) as { token: string };
    const accepted = await invitations.accept({ userId: invited.id, sessionId: '00000000-0000-0000-0000-000000000004' }, invitation.token) as { membershipId: string };
    expect(accepted.membershipId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(invitations.accept({ userId: invited.id, sessionId: '00000000-0000-0000-0000-000000000004' }, invitation.token)).rejects.toThrow();
    const membership = await prisma.membership.findUnique({ where: { id: accepted.membershipId }, include: { scopeLinks: true } });
    expect(membership?.scopeMode).toBe('SELECTED_ESTABLISHMENTS');
    expect(membership?.scopeLinks).toHaveLength(1);
    await expect(organizations.update({ userId: owner.id, sessionId: '00000000-0000-0000-0000-000000000003' }, created.id, { name: 'Tenant C updated' })).resolves.toMatchObject({ name: 'Tenant C updated' });
    await expect(organizations.update({ userId: invited.id, sessionId: '00000000-0000-0000-0000-000000000004' }, created.id, { name: 'Unauthorized update' })).rejects.toThrow();
    await expect(organizations.getEstablishment({ userId: invited.id, sessionId: '00000000-0000-0000-0000-000000000004' }, created.id, created.establishment.id)).resolves.toMatchObject({ id: created.establishment.id });
    await expect(organizations.getEstablishment({ userId: invited.id, sessionId: '00000000-0000-0000-0000-000000000004' }, created.id, secondEstablishment.id)).rejects.toThrow();
  });

  it('records logout as an auditable session revocation', async () => {
    const owner = await auth.register({ email: 'logout@example.com', password: 'correct horse battery staple', firstName: 'Logout', lastName: 'User' });
    const tokens = await auth.login({ identifier: owner.email, password: 'correct horse battery staple' });
    await auth.logout({ userId: owner.id, sessionId: tokens.sessionId });
    await expect(prisma.auditEvent.findFirst({ where: { actorUserId: owner.id, action: 'SESSION_REVOKED' }, orderBy: { occurredAt: 'desc' } })).resolves.toMatchObject({ targetType: 'RefreshSession' });
  });

  it('enforces explicit commercial module activation with idempotent audit and outbox behavior', async () => {
    const owner = await auth.register({ email: 'activation@example.com', password: 'correct horse battery staple', firstName: 'Activation', lastName: 'Owner' });
    const created = await organizations.create({ userId: owner.id, sessionId: '00000000-0000-0000-0000-000000000005' }, {
      businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Activation tenant', handle: 'activation-tenant', defaultCurrency: 'EUR', establishmentName: 'Head office',
    }) as { id: string };
    await expect(organizations.quotas({ userId: owner.id, sessionId: '00000000-0000-0000-0000-000000000005' }, created.id)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ quotaCode: 'MAX_USERS', limit: '5', used: '1', reserved: '0' })]));

    await expect(organizations.updateModuleActivation({ userId: owner.id, sessionId: '00000000-0000-0000-0000-000000000005' }, created.id, 'CATALOG', false, 'disable for onboarding')).resolves.toMatchObject({ moduleCode: 'CATALOG', enabled: false, changed: true });
    await expect(organizations.updateModuleActivation({ userId: owner.id, sessionId: '00000000-0000-0000-0000-000000000005' }, created.id, 'CATALOG', false, 'duplicate callback')).resolves.toMatchObject({ changed: false });
    const capabilities = await organizations.capabilities({ userId: owner.id, sessionId: '00000000-0000-0000-0000-000000000005' }, created.id) as { modules: Array<{ code: string; allowed: boolean; reason: string }> };
    expect(capabilities.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CATALOG', allowed: false, reason: 'MODULE_DEACTIVATED' })]));
    await expect(prisma.auditEvent.count({ where: { organizationId: created.id, action: 'MODULE_ACTIVATION_CHANGED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId: created.id, eventType: 'module.activation_changed' } })).resolves.toBe(1);
    await expect(organizations.updateModuleActivation({ userId: owner.id, sessionId: '00000000-0000-0000-0000-000000000005' }, created.id, 'AUTH', false, 'must fail')).rejects.toThrow();
    await expect(organizations.updateModuleActivation({ userId: owner.id, sessionId: '00000000-0000-0000-0000-000000000005' }, created.id, 'CATALOG', true, 're-enable after onboarding')).resolves.toMatchObject({ enabled: true, changed: true });
  });
});
