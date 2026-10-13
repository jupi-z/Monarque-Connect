import type { Permission } from '../tenancy/authorization.service.js';

export const purchasesPermissions = [
  'purchases:rfqs:read',
  'purchases:rfqs:write',
  'purchases:orders:read',
  'purchases:orders:write',
  'purchases:receipts:read',
  'purchases:receipts:write',
] as const satisfies readonly Permission[];

export type PurchasePermission = (typeof purchasesPermissions)[number];
