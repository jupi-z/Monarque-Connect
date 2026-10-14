import { describe, expect, it } from 'vitest';
import { MemoryStorageAdapter } from '../../src/documents/memory-storage.adapter.js';

describe('Phase 8 provider-neutral document storage adapter', () => {
  it('keeps upload metadata opaque and rejects a completion with a different size', async () => {
    const storage = new MemoryStorageAdapter();
    const session = await storage.beginUpload({ documentId: 'document-1', mediaType: 'text/plain', byteSize: 5n });

    expect(session.storageKey).toContain('memory/document-1/');
    expect(session.uploadToken).toBe(session.storageKey);
    await expect(storage.completeUpload(session.storageKey, 'a'.repeat(64), 4n)).rejects.toThrow('byte size');
    await storage.completeUpload(session.storageKey, 'a'.repeat(64), 5n);
    await expect(storage.readStream(session.storageKey)).resolves.toBeDefined();
  });

  it('makes revoked content inaccessible without deleting its metadata key', async () => {
    const storage = new MemoryStorageAdapter();
    const session = await storage.beginUpload({ documentId: 'document-2', mediaType: 'text/plain', byteSize: 1n });
    await storage.completeUpload(session.storageKey, 'b'.repeat(64), 1n);
    await storage.revoke(session.storageKey);

    await expect(storage.readStream(session.storageKey)).rejects.toThrow('unavailable');
  });
});
