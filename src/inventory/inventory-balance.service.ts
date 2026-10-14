import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { InventoryListQuery } from './inventory.dto.js';

@Injectable()
export class InventoryBalanceService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService) {}

  async list(principal: AuthPrincipal, organizationId: string, query: InventoryListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:read');
    if (query.establishmentId) await this.authorization.assertEstablishment(context, query.establishmentId);
    const establishmentIds = query.establishmentId ? [query.establishmentId] : context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? Array.from(context.establishmentIds) : undefined;
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.inventoryBalance.findMany({
      where: {
        organizationId,
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.itemId ? { itemId: query.itemId } : {}),
        ...(establishmentIds ? { warehouse: { establishmentId: { in: establishmentIds }, organizationId } } : {}),
        ...(cursor ? { OR: [{ updatedAt: { gt: new Date(cursor.updatedAt) } }, { updatedAt: new Date(cursor.updatedAt), warehouseId: { gt: cursor.warehouseId } }, { updatedAt: new Date(cursor.updatedAt), warehouseId: cursor.warehouseId, itemId: { gt: cursor.itemId } }] } : {}),
      },
      orderBy: [{ updatedAt: 'asc' }, { warehouseId: 'asc' }, { itemId: 'asc' }],
      take: limit + 1,
      select: { organizationId: true, warehouseId: true, itemId: true, quantity: true, updatedAt: true, warehouse: { select: { establishmentId: true } } },
    });
    const items = rows.slice(0, limit).map((row) => ({ organizationId: row.organizationId, establishmentId: row.warehouse.establishmentId, warehouseId: row.warehouseId, itemId: row.itemId, quantity: row.quantity.toFixed(6), asOf: row.updatedAt.toISOString() }));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ updatedAt: next.updatedAt.toISOString(), warehouseId: next.warehouseId, itemId: next.itemId }) : null };
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

  private encodeCursor(cursor: { updatedAt: string; warehouseId: string; itemId: string }): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }

  private decodeCursor(value: string): { updatedAt: string; warehouseId: string; itemId: string } {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { updatedAt?: string; warehouseId?: string; itemId?: string };
      if (!parsed.updatedAt || !parsed.warehouseId || !parsed.itemId || Number.isNaN(Date.parse(parsed.updatedAt))) throw new Error();
      return { updatedAt: parsed.updatedAt, warehouseId: parsed.warehouseId, itemId: parsed.itemId };
    } catch {
      throw new BadRequestException('Cursor is invalid');
    }
  }
}
