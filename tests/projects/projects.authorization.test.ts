import { describe, expect, it } from 'vitest';
import { rolePermissions } from '../../src/tenancy/authorization.service.js';

describe('Phase 8 centralized permissions', () => {
  it('grants project and document read/write to owner and admin', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      expect(rolePermissions[role]).toEqual(expect.arrayContaining([
        'projects:read', 'projects:write', 'documents:read', 'documents:write',
      ]));
    }
  });

  it('grants scoped project/document work to operations and sales', () => {
    for (const role of ['OPERATIONS', 'SALES'] as const) {
      expect(rolePermissions[role]).toEqual(expect.arrayContaining([
        'projects:read', 'projects:write', 'documents:read', 'documents:write',
      ]));
    }
  });

  it('keeps finance and viewer read-only for Phase 8', () => {
    for (const role of ['FINANCE', 'VIEWER'] as const) {
      expect(rolePermissions[role]).toEqual(expect.arrayContaining(['projects:read', 'documents:read']));
      expect(rolePermissions[role]).not.toEqual(expect.arrayContaining(['projects:write', 'documents:write']));
    }
  });
});
