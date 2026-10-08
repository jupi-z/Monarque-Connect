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
});
