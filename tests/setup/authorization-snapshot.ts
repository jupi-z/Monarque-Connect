import type { PrismaService } from '../../src/database/prisma.service.js';

/** Minimal tenant authorization state. Deliberately excludes names, emails, tokens and identifiers. */
export async function authorizationSnapshot(prisma: PrismaService, organizationId: string): Promise<unknown> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      status: true,
      businessTypeCode: true,
      memberships: {
        select: { role: true, status: true, scopeMode: true, user: { select: { status: true } } },
      },
      subscriptions: {
        orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
        take: 3,
        select: {
          status: true,
          startsAt: true,
          endsAt: true,
          planVersion: {
            select: {
              planCode: true,
              version: true,
              status: true,
              modules: { select: { moduleCode: true, defaultEnabled: true } },
              quotas: { select: { quotaCode: true, mode: true, limitValue: true } },
            },
          },
        },
      },
      moduleActivations: { select: { moduleCode: true, enabled: true } },
      entitlements: { select: { moduleCode: true, effect: true, startsAt: true, endsAt: true } },
      quotaUsages: { select: { quotaCode: true, periodKey: true, limitValue: true, usedValue: true, reservedValue: true } },
    },
  });
  return organization;
}
