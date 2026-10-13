import { describe, expect, it } from 'vitest';
import { rolePermissions, type Permission } from '../../src/tenancy/authorization.service.js';
import { purchasesPermissions } from '../../src/purchases/purchases.permissions.js';

const purchaseReadPermissions = [
  'purchases:rfqs:read',
  'purchases:orders:read',
  'purchases:receipts:read',
] as const satisfies readonly Permission[];

const purchaseWritePermissions = [
  'purchases:rfqs:write',
  'purchases:orders:write',
  'purchases:receipts:write',
] as const satisfies readonly Permission[];

describe('Phase 6 Purchases authorization contract', () => {
  it('defines the six canonical Purchases permission literals', () => {
    expect(purchasesPermissions).toEqual(expect.arrayContaining([...purchaseReadPermissions, ...purchaseWritePermissions]));
    expect(new Set(purchasesPermissions).size).toBe(6);
  });

  it('applies the normative Purchases role matrix', () => {
    expect(rolePermissions.OWNER).toEqual(expect.arrayContaining([...purchaseReadPermissions, ...purchaseWritePermissions]));
    expect(rolePermissions.ADMIN).toEqual(expect.arrayContaining([...purchaseReadPermissions, ...purchaseWritePermissions]));
    expect(rolePermissions.OPERATIONS).toEqual(expect.arrayContaining([...purchaseReadPermissions, ...purchaseWritePermissions]));
    expect(rolePermissions.FINANCE).toEqual(expect.arrayContaining([...purchaseReadPermissions]));
    expect(rolePermissions.FINANCE).not.toEqual(expect.arrayContaining([...purchaseWritePermissions]));
    expect(rolePermissions.VIEWER).toEqual(expect.arrayContaining([...purchaseReadPermissions]));
    expect(rolePermissions.VIEWER).not.toEqual(expect.arrayContaining([...purchaseWritePermissions]));
    expect(rolePermissions.SALES).not.toEqual(expect.arrayContaining([...purchasesPermissions]));
  });
});
