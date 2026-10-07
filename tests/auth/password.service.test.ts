import { describe, expect, it } from 'vitest';
import { PasswordService } from '../../src/auth/password.service.js';

describe('PasswordService', () => {
  it('hashes with a verifiable Argon2id hash and rejects the wrong password', async () => {
    const service = new PasswordService();
    const hash = await service.hash('correct horse battery staple');
    expect(hash).toContain('$argon2id$');
    await expect(service.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong password')).resolves.toBe(false);
  });
});
