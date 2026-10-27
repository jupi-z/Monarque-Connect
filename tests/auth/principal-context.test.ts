import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '../../src/auth/auth.guard.js';
import { AuthorizationService } from '../../src/tenancy/authorization.service.js';

describe('C2 trusted actor provenance', () => {
  it('derives STAFF provenance from the verified legacy session and overwrites request supplied actor data', async () => {
    const request = {
      headers: { authorization: 'Bearer signed-token' },
      user: { userId: 'attacker-user', sessionId: 'attacker-session' },
      actorPrincipal: { actorType: 'PLATFORM', userId: 'attacker-user' },
    };
    const guard = new AuthGuard(
      { verifyAccessToken: vi.fn().mockResolvedValue({ sub: 'user-1', sid: 'session-1' }) } as never,
      { refreshSession: { findFirst: vi.fn().mockResolvedValue({ id: 'session-1' }) } } as never,
    );
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as never;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ userId: 'user-1', sessionId: 'session-1' });
    expect(request.actorPrincipal).toEqual({
      actorType: 'STAFF',
      userId: 'user-1',
      sessionId: 'session-1',
      provenance: { kind: 'LEGACY_SESSION' },
    });
  });
});

describe('C2 product-scoped staff authorization', () => {
  const membership = {
    id: 'membership-1', role: 'OWNER', scopeMode: 'ALL_ESTABLISHMENTS', scopeLinks: [],
  };
  const principal = { userId: 'user-1', sessionId: 'session-1' };

  it('resolves the requested product explicitly and returns a product-bound server context', async () => {
    const prisma = { membership: { findFirst: vi.fn().mockResolvedValue(membership) } };
    const entitlements = { resolveForProduct: vi.fn().mockResolvedValue({
      organizationId: 'org-1', productCode: 'ZAMUREK', modules: [{ code: 'ZAMUREK_CORE', allowed: true }],
    }) };
    const authorization = new AuthorizationService(prisma as never, entitlements as never);

    await expect(authorization.requireModuleForProduct(principal, 'org-1', 'ZAMUREK', 'ZAMUREK_CORE', 'organization:read'))
      .resolves.toMatchObject({ ...principal, organizationId: 'org-1', membershipId: 'membership-1', productCode: 'ZAMUREK' });
    expect(entitlements.resolveForProduct).toHaveBeenCalledWith('org-1', 'ZAMUREK');
  });

  it('rejects invalid or mismatched products without falling back to legacy entitlements', async () => {
    const prisma = { membership: { findFirst: vi.fn().mockResolvedValue(membership) } };
    const entitlements = {
      resolve: vi.fn(),
      resolveForProduct: vi.fn().mockResolvedValue({
        organizationId: 'org-1', productCode: 'MONARQUE_CONNECT', modules: [{ code: 'CRM', allowed: true }],
      }),
    };
    const authorization = new AuthorizationService(prisma as never, entitlements as never);

    await expect(authorization.requireModuleForProduct(principal, 'org-1', 'UNKNOWN' as never, 'CRM', 'crm:read'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(authorization.requireModuleForProduct(principal, 'org-1', 'ZAMUREK', 'CRM', 'crm:read'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(entitlements.resolve).not.toHaveBeenCalled();
    expect(entitlements.resolveForProduct).toHaveBeenCalledTimes(1);
  });

  it('denies a module absent or disabled in the selected product projection', async () => {
    const prisma = { membership: { findFirst: vi.fn().mockResolvedValue(membership) } };
    const entitlements = { resolveForProduct: vi.fn().mockResolvedValue({
      organizationId: 'org-1', productCode: 'ZAMUREK', modules: [{ code: 'ZAMUREK_CORE', allowed: false }],
    }) };
    const authorization = new AuthorizationService(prisma as never, entitlements as never);

    await expect(authorization.requireModuleForProduct(principal, 'org-1', 'ZAMUREK', 'CRM', 'crm:read'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechecks membership and the exact product projection inside the caller transaction', async () => {
    const tx = {
      membership: {
        findUnique: vi.fn().mockResolvedValueOnce({ id: 'membership-1' }).mockResolvedValueOnce({
          id: 'membership-1', status: 'ACTIVE', role: 'OWNER', scopeMode: 'SELECTED_ESTABLISHMENTS',
          scopeLinks: [{ establishmentId: 'est-1' }], user: { status: 'ACTIVE' }, organization: { status: 'ACTIVE' },
        }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'membership-1' }]),
    };
    const entitlements = { resolveForProduct: vi.fn().mockResolvedValue({
      organizationId: 'org-1', productCode: 'ZAMUREK', modules: [{ code: 'ZAMUREK_CORE', allowed: true }],
    }) };
    const authorization = new AuthorizationService({} as never, entitlements as never);

    await expect(authorization.requireModuleForProductInTransaction(
      tx as never, principal, 'org-1', 'ZAMUREK', 'ZAMUREK_CORE', 'organization:read',
    )).resolves.toMatchObject({ productCode: 'ZAMUREK', scopeMode: 'SELECTED_ESTABLISHMENTS', establishmentIds: ['est-1'] });
    expect(entitlements.resolveForProduct).toHaveBeenCalledWith('org-1', 'ZAMUREK', expect.any(Date), tx);
  });
});
