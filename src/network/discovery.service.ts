import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { DiscoveryQuery } from './discovery.dto.js';

type DiscoveryCursor = { updatedAt: string; organizationId: string };

@Injectable()
export class NetworkDiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: DiscoveryQuery): Promise<unknown> {
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.organizationNetworkProfile.findMany({
      where: {
        isPublic: true,
        organization: {
          status: 'ACTIVE',
          ...(query.businessTypeCode ? { businessTypeCode: query.businessTypeCode.trim() } : {}),
          ...(query.verified === true ? { networkTrust: { is: { verificationStatus: 'VERIFIED' } } } : {}),
          ...(query.verified === false ? { NOT: { networkTrust: { is: { verificationStatus: 'VERIFIED' } } } } : {}),
        },
        ...(query.q ? { displayName: { contains: query.q.trim(), mode: 'insensitive' as const } } : {}),
        ...(cursor ? { OR: [{ updatedAt: { gt: new Date(cursor.updatedAt) } }, { updatedAt: new Date(cursor.updatedAt), organizationId: { gt: cursor.organizationId } }] } : {}),
      },
      orderBy: [{ updatedAt: 'asc' }, { organizationId: 'asc' }],
      take: limit + 1,
      select: { organizationId: true, displayName: true, description: true, categories: true, publicLocation: true, publishedItemIds: true, publishedAt: true, updatedAt: true, organization: { select: { businessTypeCode: true, networkTrust: { select: { verificationStatus: true } } } } },
    });
    const visible = rows.slice(0, limit).map((profile) => this.serialize(profile));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items: visible, nextCursor: next ? this.encodeCursor({ updatedAt: next.updatedAt.toISOString(), organizationId: next.organizationId }) : null };
  }

  private serialize(profile: { organizationId: string; displayName: string; description: string | null; categories: Prisma.JsonValue; publicLocation: string | null; publishedItemIds: Prisma.JsonValue; publishedAt: Date | null; organization: { businessTypeCode: string; networkTrust: { verificationStatus: string } | null } }): unknown {
    return { organizationId: profile.organizationId, displayName: profile.displayName, description: profile.description, businessTypeCode: profile.organization.businessTypeCode, categories: this.strings(profile.categories), publicLocation: profile.publicLocation, verified: profile.organization.networkTrust?.verificationStatus === 'VERIFIED', publishedItemIds: this.strings(profile.publishedItemIds), publishedAt: profile.publishedAt?.toISOString() ?? null };
  }

  private strings(value: Prisma.JsonValue): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
  private encodeCursor(cursor: DiscoveryCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): DiscoveryCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<DiscoveryCursor>;
      if (typeof parsed.updatedAt !== 'string' || typeof parsed.organizationId !== 'string' || Number.isNaN(Date.parse(parsed.updatedAt))) throw new Error('invalid');
      return { updatedAt: parsed.updatedAt, organizationId: parsed.organizationId };
    } catch { throw new BadRequestException('Cursor is invalid'); }
  }
}
