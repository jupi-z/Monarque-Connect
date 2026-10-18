import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const TOKEN_TTL_MS = 15 * 60 * 1000;

function encryptionKey(): Buffer {
  const configured = process.env.MESSAGING_INVITATION_TOKEN_KEY;
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (!configured && nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error('MESSAGING_INVITATION_TOKEN_KEY is required outside local development and tests');
  }
  const key = configured ?? 'monarque-connect-test-only-messaging-key';
  return createHash('sha256').update(key).digest();
}

export function tokenDigest(token: string): string { return createHash('sha256').update(token).digest('hex'); }

export function tokenExpiry(now = new Date()): Date { return new Date(now.getTime() + TOKEN_TTL_MS); }

export function encryptInvitationToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptInvitationToken(value: string): string {
  const [version, ivText, tagText, ciphertextText] = value.split('.');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText) throw new Error('Invalid invitation token ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
}
