import { describe, expect, it } from 'vitest';
import { rolePermissions } from '../../src/tenancy/authorization.service.js';

describe('tenant authorization policy', () => {
  it('allows only owner and admin to write organizations, establishments, and memberships', () => {
    expect(rolePermissions.OWNER).toContain('organization:write');
    expect(rolePermissions.ADMIN).toContain('organization:write');
    for (const role of ['SALES', 'FINANCE', 'OPERATIONS', 'VIEWER'] as const) {
      expect(rolePermissions[role]).not.toContain('organization:write');
      expect(rolePermissions[role]).not.toContain('establishments:write');
      expect(rolePermissions[role]).not.toContain('memberships:write');
    }
  });

  it('keeps every supported role read-only for capabilities and establishments when not administrative', () => {
    for (const role of ['SALES', 'FINANCE', 'OPERATIONS', 'VIEWER'] as const) {
      expect(rolePermissions[role]).toEqual(expect.arrayContaining(['organization:read', 'establishments:read', 'capabilities:read']));
    }
  });

  it('applies the Phase 3 role matrix to parties, catalog and inventory', () => {
    for (const role of ['OWNER', 'ADMIN', 'SALES', 'FINANCE', 'OPERATIONS', 'VIEWER'] as const) {
      expect(rolePermissions[role]).toEqual(expect.arrayContaining(['parties:read', 'catalog:read', 'inventory:read']));
    }

    for (const role of ['OWNER', 'ADMIN', 'SALES', 'OPERATIONS'] as const) {
      expect(rolePermissions[role]).toEqual(expect.arrayContaining(['parties:write', 'catalog:write']));
    }

    for (const role of ['OWNER', 'ADMIN', 'OPERATIONS'] as const) {
      expect(rolePermissions[role]).toContain('inventory:write');
    }

    expect(rolePermissions.SALES).not.toContain('inventory:write');
    expect(rolePermissions.FINANCE).not.toContain('inventory:write');
    expect(rolePermissions.VIEWER).not.toContain('inventory:write');

    for (const role of ['FINANCE', 'VIEWER'] as const) {
      expect(rolePermissions[role]).not.toContain('parties:write');
      expect(rolePermissions[role]).not.toContain('catalog:write');
      expect(rolePermissions[role]).not.toContain('inventory:write');
    }
  });
});
