import type { Permission } from '../tenancy/authorization.service.js';

export const salesPermissions = [
  'sales:quotes:read',
  'sales:quotes:write',
  'sales:orders:read',
  'sales:orders:write',
  'sales:invoices:read',
  'sales:invoices:write',
  'sales:payments:read',
  'sales:payments:write',
] as const satisfies readonly Permission[];

export type SalesPermission = (typeof salesPermissions)[number];
