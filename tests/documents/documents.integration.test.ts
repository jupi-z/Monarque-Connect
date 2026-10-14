import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { MemoryStorageAdapter } from '../../src/documents/memory-storage.adapter.js';

describe('Phase 8 provider-neutral document storage adapter', () => {
  it('requires a real binary transfer and verifies its exact size and checksum before availability', async () => {
    const storage = new MemoryStorageAdapter();
    const content = Buffer.from('hello');
    const checksum = createHash('sha256').update(content).digest('hex');
    const session = await storage.beginUpload({ documentId: 'document-1', mediaType: 'text/plain', byteSize: BigInt(content.length) });

    expect(session.storageKey).toContain('memory/document-1/');
    expect(session.uploadToken).not.toBe(session.storageKey);
    await expect(storage.completeUpload(session.storageKey, checksum, BigInt(content.length))).rejects.toThrow('content');
    await storage.writeUpload(session.storageKey, session.uploadToken, Readable.from(content));
    await expect(storage.completeUpload(session.storageKey, 'a'.repeat(64), BigInt(content.length))).rejects.toThrow('checksum');
    await storage.completeUpload(session.storageKey, checksum, BigInt(content.length));
    await expect(storage.completeUpload(session.storageKey, 'b'.repeat(64), BigInt(content.length))).rejects.toThrow('checksum');
    const stream = await storage.readStream(session.storageKey);
    expect(Buffer.concat(await streamToBuffers(stream))).toEqual(content);
  });

  it('makes revoked content inaccessible without deleting its metadata key', async () => {
    const storage = new MemoryStorageAdapter();
    const content = Buffer.from('x');
    const session = await storage.beginUpload({ documentId: 'document-2', mediaType: 'text/plain', byteSize: 1n });
    await storage.writeUpload(session.storageKey, session.uploadToken, Readable.from(content));
    await storage.completeUpload(session.storageKey, createHash('sha256').update(content).digest('hex'), 1n);
    await storage.revoke(session.storageKey);

    await expect(storage.readStream(session.storageKey)).rejects.toThrow('unavailable');
  });

  it('rejects an upload token replay with different bytes and preserves the first content', async () => {
    const storage = new MemoryStorageAdapter();
    const session = await storage.beginUpload({ documentId: 'document-3', mediaType: 'text/plain', byteSize: 5n });
    await storage.writeUpload(session.storageKey, session.uploadToken, Readable.from(Buffer.from('hello')));
    await expect(storage.writeUpload(session.storageKey, session.uploadToken, Readable.from(Buffer.from('world')))).rejects.toThrow('different content');
  });
});

async function streamToBuffers(stream: NodeJS.ReadableStream): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks;
}
