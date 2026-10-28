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
    for (const role of ['OWNER', 'ADMIN', 'FINANCE', 'OPERATIONS', 'VIEWER'] as const) {
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

  it('keeps commercial price publishing separate from catalog writes and quote permissions', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      expect(rolePermissions[role]).toContain('pricing:price:publish');
      expect(rolePermissions[role]).toContain('pricing:policy:manage');
      expect(rolePermissions[role]).toContain('pricing:tax:manage');
    }
    for (const role of ['SALES', 'OPERATIONS'] as const) {
      expect(rolePermissions[role]).toEqual(expect.arrayContaining(['pricing:quote:create', 'pricing:quote:read']));
      expect(rolePermissions[role]).not.toContain('pricing:price:publish');
      expect(rolePermissions[role]).not.toContain('pricing:policy:manage');
      expect(rolePermissions[role]).not.toContain('pricing:tax:manage');
    }
    expect(rolePermissions.FINANCE).toContain('pricing:quote:read');
    expect(rolePermissions.FINANCE).not.toContain('pricing:quote:create');
    expect(rolePermissions.FINANCE).not.toContain('pricing:price:publish');
    for (const role of ['VIEWER'] as const) {
      expect(rolePermissions[role]).not.toContain('pricing:quote:create');
      expect(rolePermissions[role]).not.toContain('pricing:quote:read');
      expect(rolePermissions[role]).not.toContain('pricing:price:publish');
      expect(rolePermissions[role]).not.toContain('pricing:policy:manage');
      expect(rolePermissions[role]).not.toContain('pricing:tax:manage');
    }
  });

  it('applies the Phase 4 CRM role matrix', () => {
    for (const role of ['OWNER', 'ADMIN', 'SALES', 'FINANCE', 'OPERATIONS', 'VIEWER'] as const) {
      expect(rolePermissions[role]).toContain('crm:read');
    }

    for (const role of ['OWNER', 'ADMIN', 'SALES'] as const) {
      expect(rolePermissions[role]).toContain('crm:write');
    }

    for (const role of ['FINANCE', 'OPERATIONS', 'VIEWER'] as const) {
      expect(rolePermissions[role]).not.toContain('crm:write');
    }
  });

  it('keeps Network entry permissions separate and deny-by-default for finance', () => {
    for (const role of ['OWNER', 'ADMIN', 'SALES', 'OPERATIONS', 'VIEWER'] as const) {
      expect(rolePermissions[role]).toEqual(
        expect.arrayContaining(['network:discovery:read', 'network:connections:read', 'network:inquiries:read']),
      );
    }

    for (const role of ['OWNER', 'ADMIN', 'SALES', 'OPERATIONS'] as const) {
      expect(rolePermissions[role]).toEqual(
        expect.arrayContaining(['network:connections:write', 'network:inquiries:write']),
      );
    }

    expect(rolePermissions.OWNER).toEqual(expect.arrayContaining(['network:profile:read', 'network:profile:write', 'network:trust:read']));
    expect(rolePermissions.ADMIN).toEqual(expect.arrayContaining(['network:profile:read', 'network:profile:write', 'network:trust:read']));

    for (const role of ['FINANCE', 'VIEWER'] as const) {
      expect(rolePermissions[role]).not.toContain('network:connections:write');
      expect(rolePermissions[role]).not.toContain('network:inquiries:write');
    }

    for (const permission of [
      'network:discovery:read',
      'network:connections:read',
      'network:connections:write',
      'network:inquiries:read',
      'network:inquiries:write',
      'network:profile:read',
      'network:profile:write',
      'network:trust:read',
    ] as const) {
      expect(rolePermissions.FINANCE).not.toContain(permission);
    }
  });

  it('applies the Phase 7 Operations role matrix to Inventory, Expenses and Cash', () => {
    for (const role of ['OWNER', 'ADMIN', 'FINANCE', 'OPERATIONS', 'VIEWER'] as const) {
      expect(rolePermissions[role]).toContain('inventory:read');
      expect(rolePermissions[role]).toContain('expenses:read');
      expect(rolePermissions[role]).toContain('cash:read');
    }

    for (const role of ['OWNER', 'ADMIN', 'OPERATIONS'] as const) {
      expect(rolePermissions[role]).toContain('inventory:write');
    }
    for (const role of ['OWNER', 'ADMIN', 'FINANCE', 'OPERATIONS'] as const) {
      expect(rolePermissions[role]).toContain('expenses:write');
    }
    for (const role of ['OWNER', 'ADMIN', 'FINANCE'] as const) {
      expect(rolePermissions[role]).toContain('cash:write');
    }

    expect(rolePermissions.SALES).not.toEqual(expect.arrayContaining(['inventory:read', 'expenses:read', 'cash:read']));
    expect(rolePermissions.FINANCE).not.toContain('inventory:write');
    expect(rolePermissions.OPERATIONS).not.toContain('cash:write');
    expect(rolePermissions.VIEWER).not.toEqual(expect.arrayContaining(['inventory:write', 'expenses:write', 'cash:write']));
  });

  it('grants Intelligence read to every tenant role without granting source permissions', () => {
    for (const role of ['OWNER', 'ADMIN', 'SALES', 'FINANCE', 'OPERATIONS', 'VIEWER'] as const) {
      expect(rolePermissions[role]).toContain('intelligence:read');
    }
    expect(rolePermissions.VIEWER).not.toContain('sales:payments:write');
  });
});
