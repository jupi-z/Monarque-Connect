import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';

@Injectable()
export class InventoryBalanceService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService) {}

  async list(principal: AuthPrincipal, organizationId: string, establishmentId: string, warehouseId?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:read');
    await this.authorization.assertEstablishment(context, establishmentId);
    const rows = await this.prisma.inventoryBalance.findMany({ where: { organizationId, ...(warehouseId ? { warehouseId } : {}), warehouse: { establishmentId, organizationId } }, orderBy: [{ warehouseId: 'asc' }, { itemId: 'asc' }] });
    return { items: rows.map((row) => ({ ...row, quantity: row.quantity.toFixed(6), updatedAt: row.updatedAt.toISOString() })) };
  }

  async reconstruct(principal: AuthPrincipal, organizationId: string, establishmentId: string, warehouseId?: string, itemId?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:read');
    await this.authorization.assertEstablishment(context, establishmentId);
    const rows = await this.prisma.inventoryMovement.groupBy({
      by: ['warehouseId', 'itemId'],
      where: { organizationId, establishmentId, ...(warehouseId ? { warehouseId } : {}), ...(itemId ? { itemId } : {}) },
      _sum: { quantityDelta: true },
      orderBy: [{ warehouseId: 'asc' }, { itemId: 'asc' }],
    });
    return { items: rows.map((row) => ({ warehouseId: row.warehouseId, itemId: row.itemId, quantity: (row._sum.quantityDelta ?? new Prisma.Decimal(0)).toFixed(6) })) };
  }
}
