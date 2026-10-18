import { describe, expect, it, afterEach } from 'vitest';
import { decryptInvitationToken, encryptInvitationToken } from '../src/messaging/invitation-token.js';
import { MessagingAbuseService } from '../src/messaging/abuse.service.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalInvitationKey = process.env.MESSAGING_INVITATION_TOKEN_KEY;
const originalAbuseKey = process.env.MESSAGING_ABUSE_HMAC_KEY;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  process.env.MESSAGING_INVITATION_TOKEN_KEY = originalInvitationKey;
  process.env.MESSAGING_ABUSE_HMAC_KEY = originalAbuseKey;
});

describe('Phase 9 messaging secret configuration', () => {
  it('permits deterministic fallback only in tests and never uses the JWT key', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MESSAGING_INVITATION_TOKEN_KEY;
    process.env.JWT_PRIVATE_KEY_PEM = 'must-not-be-used-as-a-messaging-secret';
    const ciphertext = encryptInvitationToken('test-token');
    expect(decryptInvitationToken(ciphertext)).toBe('test-token');
  });

  it.each(['staging', 'production'] as const)('fails closed for invitation tokens in %s without a dedicated key', (nodeEnv) => {
    process.env.NODE_ENV = nodeEnv;
    delete process.env.MESSAGING_INVITATION_TOKEN_KEY;
    expect(() => encryptInvitationToken('token')).toThrow(/MESSAGING_INVITATION_TOKEN_KEY/);
  });

  it.each(['staging', 'production'] as const)('fails closed for abuse fingerprints in %s without a dedicated key', async (nodeEnv) => {
    process.env.NODE_ENV = nodeEnv;
    delete process.env.MESSAGING_ABUSE_HMAC_KEY;
    const tx = { $queryRaw: () => Promise.resolve([]), $executeRaw: () => Promise.resolve(1) } as never;
    await expect(new MessagingAbuseService().reserve(tx, {
      actorUserId: '00000000-0000-0000-0000-000000000001',
      organizationId: '00000000-0000-0000-0000-000000000002',
      targetOrganizationId: '00000000-0000-0000-0000-000000000003',
      conversationId: '00000000-0000-0000-0000-000000000004',
      body: 'spam',
    })).rejects.toThrow(/MESSAGING_ABUSE_HMAC_KEY/);
  });
});
