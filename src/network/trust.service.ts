import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class NetworkTrustService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublic(organizationId: string): Promise<unknown> {
    const profile = await this.prisma.organizationNetworkProfile.findFirst({ where: { organizationId, isPublic: true, organization: { status: 'ACTIVE' } }, select: { organizationId: true } });
    if (!profile) throw new NotFoundException('Public organization trust profile not found');
    const trust = await this.prisma.organizationNetworkTrust.findUnique({ where: { organizationId }, select: { verificationStatus: true, verifiedAt: true, verificationExpiresAt: true, publishedCredentials: true } });
    return { organizationId, verificationStatus: trust?.verificationStatus ?? 'UNVERIFIED', verifiedAt: trust?.verifiedAt?.toISOString() ?? null, verificationExpiresAt: trust?.verificationExpiresAt?.toISOString() ?? null, publishedCredentials: this.credentials(trust?.publishedCredentials ?? []) };
  }

  private credentials(value: Prisma.JsonValue): Array<{ label: string; issuer: string; validUntil: string | null }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.label !== 'string' || typeof candidate.issuer !== 'string') return [];
      return [{ label: candidate.label, issuer: candidate.issuer, validUntil: typeof candidate.validUntil === 'string' ? candidate.validUntil : null }];
    });
  }
}
