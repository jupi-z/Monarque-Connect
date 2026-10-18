import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MessagingAuthorization } from '../src/messaging/messaging.authorization.js';
import { MessagingPolicy } from '../src/network/messaging-policy.service.js';
import { rolePermissions } from '../src/tenancy/authorization.service.js';

const principal = { userId: randomUUID(), sessionId: randomUUID() };

function organization(id: string, isPublic = true): { id: string; status: 'ACTIVE'; networkProfile: { isPublic: boolean } } {
  return { id, status: 'ACTIVE', networkProfile: { isPublic } };
}

describe('Phase 9 Messaging authorization policy', () => {
  it('grants read to tenant roles but reserves writes, participant management and blocks', () => {
    for (const role of ['OWNER', 'ADMIN', 'SALES', 'OPERATIONS', 'VIEWER'] as const) {
      expect(rolePermissions[role]).toContain('messaging:read');
    }
    for (const role of ['OWNER', 'ADMIN', 'SALES', 'OPERATIONS'] as const) {
      expect(rolePermissions[role]).toContain('messaging:write');
    }
    for (const role of ['FINANCE', 'VIEWER'] as const) {
      expect(rolePermissions[role]).not.toContain('messaging:write');
      expect(rolePermissions[role]).not.toContain('messaging:participants:write');
      expect(rolePermissions[role]).not.toContain('messaging:block:write');
    }
    expect(rolePermissions.OWNER).toEqual(expect.arrayContaining(['messaging:participants:write', 'messaging:block:write']));
    expect(rolePermissions.ADMIN).toEqual(expect.arrayContaining(['messaging:participants:write', 'messaging:block:write']));
  });

  it('requires an accepted Network connection and verified non-expired sender', async () => {
    const sourceOrganizationId = randomUUID();
    const targetOrganizationId = randomUUID();
    const prisma = {
      organization: { findMany: vi.fn().mockResolvedValue([organization(sourceOrganizationId), organization(targetOrganizationId)]) },
      connectionRequest: { findFirst: vi.fn().mockResolvedValue({ id: randomUUID(), status: 'ACCEPTED' }) },
      organizationNetworkTrust: { findUnique: vi.fn().mockResolvedValue({ verificationStatus: 'VERIFIED', verificationExpiresAt: new Date(Date.now() + 60_000) }) },
      messagingOrganizationBlock: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const entitlements = { resolve: vi.fn().mockResolvedValue({ modules: [{ code: 'MESSAGING', allowed: true }] }) };
    const policy = new MessagingPolicy(entitlements as never);

    await expect(policy.assertCanInitiate(prisma as never, principal, sourceOrganizationId, targetOrganizationId)).resolves.toBeUndefined();
    expect(prisma.connectionRequest.findFirst).toHaveBeenCalled();

    prisma.organizationNetworkTrust.findUnique = vi.fn().mockResolvedValue({ verificationStatus: 'UNVERIFIED', verificationExpiresAt: null });
    await expect(policy.assertCanInitiate(prisma as never, principal, sourceOrganizationId, targetOrganizationId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a non-participant and enforces the selected-establishment scope', async () => {
    const authorizationService = {
      requireModule: vi.fn().mockResolvedValue({ organizationId: 'org-a', scopeMode: 'SELECTED_ESTABLISHMENTS', establishmentIds: ['est-a'] }),
      assertEstablishment: vi.fn().mockRejectedValue(new ForbiddenException('Establishment access denied')),
    };
    const prisma = {
      conversationUserParticipant: { findFirst: vi.fn().mockResolvedValue(null) },
      conversationOrganizationParticipant: { findUnique: vi.fn() },
    };
    const authorization = new MessagingAuthorization(prisma as never, authorizationService as never);

    await expect(authorization.requireParticipantAccess(principal, 'org-a', randomUUID(), 'messaging:read')).rejects.toBeInstanceOf(NotFoundException);

    prisma.conversationUserParticipant.findFirst = vi.fn().mockResolvedValue({
      id: randomUUID(),
      organizationId: 'org-a',
      userId: principal.userId,
      status: 'ACTIVE',
      historyVisibleFromSequence: 4n,
    });
    prisma.conversationOrganizationParticipant.findUnique = vi.fn().mockResolvedValue({
      organizationId: 'org-a',
      establishmentId: 'est-b',
      status: 'ACTIVE',
      joinedAt: new Date(),
    });
    await expect(authorization.requireParticipantAccess(principal, 'org-a', 'conversation-a', 'messaging:read')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an active organization owner to manage invitations without granting message access', async () => {
    const authorizationService = {
      requireModule: vi.fn().mockResolvedValue({ organizationId: 'org-a', role: 'OWNER', scopeMode: 'ALL_ESTABLISHMENTS', establishmentIds: [] }),
      assertEstablishment: vi.fn(),
    };
    const organizationParticipant = { organizationId: 'org-a', establishmentId: null, status: 'ACTIVE', joinedAt: new Date() };
    const prisma = {
      conversationOrganizationParticipant: { findUnique: vi.fn().mockResolvedValue(organizationParticipant) },
    };
    const authorization = new MessagingAuthorization(prisma as never, authorizationService as never);

    await expect(authorization.requireOrganizationParticipantManagement(principal, 'org-a', 'conversation-a')).resolves.toMatchObject({
      context: { organizationId: 'org-a', role: 'OWNER' },
      organizationParticipant,
    });
  });

  it('rejects participant management for non-admin tenant roles', async () => {
    const authorizationService = {
      requireModule: vi.fn().mockResolvedValue({ organizationId: 'org-a', role: 'SALES', scopeMode: 'ALL_ESTABLISHMENTS', establishmentIds: [] }),
      assertEstablishment: vi.fn(),
    };
    const authorization = new MessagingAuthorization({ conversationOrganizationParticipant: { findUnique: vi.fn() } } as never, authorizationService as never);

    await expect(authorization.requireOrganizationParticipantManagement(principal, 'org-a', 'conversation-a')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hides an inactive or not-yet-joined organization participant', async () => {
    const authorizationService = {
      requireModule: vi.fn().mockResolvedValue({ organizationId: 'org-a', role: 'ADMIN', scopeMode: 'ALL_ESTABLISHMENTS', establishmentIds: [] }),
      assertEstablishment: vi.fn(),
    };
    const authorization = new MessagingAuthorization({ conversationOrganizationParticipant: { findUnique: vi.fn().mockResolvedValue({ organizationId: 'org-a', establishmentId: null, status: 'PENDING', joinedAt: null }) } } as never, authorizationService as never);

    await expect(authorization.requireOrganizationParticipantManagement(principal, 'org-a', 'conversation-a')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('enforces the selected-establishment scope for participant management', async () => {
    const authorizationService = {
      requireModule: vi.fn().mockResolvedValue({ organizationId: 'org-a', role: 'ADMIN', scopeMode: 'SELECTED_ESTABLISHMENTS', establishmentIds: ['est-a'] }),
      assertEstablishment: vi.fn().mockRejectedValue(new ForbiddenException('Establishment access denied')),
    };
    const authorization = new MessagingAuthorization({ conversationOrganizationParticipant: { findUnique: vi.fn().mockResolvedValue({ organizationId: 'org-a', establishmentId: 'est-b', status: 'ACTIVE', joinedAt: new Date() }) } } as never, authorizationService as never);

    await expect(authorization.requireOrganizationParticipantManagement(principal, 'org-a', 'conversation-a')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
