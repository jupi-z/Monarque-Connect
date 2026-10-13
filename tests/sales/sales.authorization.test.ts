import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AuthorizationService, rolePermissions, type Permission } from '../../src/tenancy/authorization.service.js';
import { SalesModule } from '../../src/sales/sales.module.js';
import { salesPermissions } from '../../src/sales/sales.permissions.js';

const salesReadPermissions = [
  'sales:quotes:read',
  'sales:orders:read',
  'sales:invoices:read',
  'sales:payments:read',
] as const satisfies readonly Permission[];

const salesWritePermissions = [
  'sales:quotes:write',
  'sales:orders:write',
  'sales:invoices:write',
  'sales:payments:write',
] as const satisfies readonly Permission[];

describe('Phase 5 Sales authorization', () => {
  it('defines the canonical Sales permission literals', () => {
    expect(salesPermissions).toEqual(expect.arrayContaining([...salesReadPermissions, ...salesWritePermissions]));
    expect(new Set(salesPermissions).size).toBe(salesPermissions.length);
  });

  it('applies the Sales role matrix from the normative specification', () => {
    expect(rolePermissions.OWNER).toEqual(expect.arrayContaining([...salesReadPermissions, ...salesWritePermissions]));
    expect(rolePermissions.ADMIN).toEqual(expect.arrayContaining([...salesReadPermissions, ...salesWritePermissions]));
    expect(rolePermissions.SALES).toEqual(expect.arrayContaining([
      'sales:quotes:read', 'sales:quotes:write',
      'sales:orders:read', 'sales:orders:write',
      'sales:invoices:read', 'sales:payments:read',
    ]));
    expect(rolePermissions.SALES).not.toContain('sales:invoices:write');
    expect(rolePermissions.SALES).not.toContain('sales:payments:write');
    expect(rolePermissions.FINANCE).toEqual(expect.arrayContaining([
      'sales:quotes:read', 'sales:orders:read',
      'sales:invoices:read', 'sales:invoices:write',
      'sales:payments:read', 'sales:payments:write',
    ]));
    expect(rolePermissions.FINANCE).not.toContain('sales:quotes:write');
    expect(rolePermissions.FINANCE).not.toContain('sales:orders:write');
    expect(rolePermissions.OPERATIONS).toEqual(expect.arrayContaining([
      'sales:quotes:read', 'sales:orders:read', 'sales:orders:write',
      'sales:invoices:read', 'sales:payments:read',
    ]));
    expect(rolePermissions.OPERATIONS).not.toContain('sales:quotes:write');
    expect(rolePermissions.VIEWER).toEqual(expect.arrayContaining([...salesReadPermissions]));
    expect(rolePermissions.VIEWER).not.toEqual(expect.arrayContaining([...salesWritePermissions]));
  });

  it('registers the Sales module in the application module graph', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    const appModulePromise = import('../../src/app.module.js');
    return appModulePromise.then(({ AppModule }) => {
      expect(Reflect.getMetadata('imports', AppModule)).toContain(SalesModule);
    });
  });

  it('denies a route when the SALES entitlement or activation is unavailable', async () => {
    const prisma = {
      membership: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'membership-1',
          role: 'SALES',
          scopeMode: 'ALL_ESTABLISHMENTS',
          scopeLinks: [],
        }),
      },
    };
    const entitlements = {
      resolve: vi.fn().mockResolvedValue({
        modules: [{ code: 'SALES', allowed: false, reason: 'MODULE_DEACTIVATED' }],
      }),
    };
    const authorization = new AuthorizationService(prisma as never, entitlements as never);

    await expect(authorization.requireModule(
      { userId: 'user-1', sessionId: 'session-1' },
      'organization-1',
      'SALES',
      'sales:quotes:read',
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a selected-establishment member outside the assigned scope', async () => {
    const prisma = {
      establishment: {
        findFirst: vi.fn().mockResolvedValue({ id: 'establishment-b' }),
      },
    };
    const authorization = new AuthorizationService(prisma as never, {} as never);

    await expect(authorization.assertEstablishment({
      userId: 'user-1',
      sessionId: 'session-1',
      organizationId: 'organization-1',
      membershipId: 'membership-1',
      role: 'SALES',
      scopeMode: 'SELECTED_ESTABLISHMENTS',
      establishmentIds: ['establishment-a'],
    }, 'establishment-b')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
