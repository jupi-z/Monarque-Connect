import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { NotFoundException, ConflictException, Injectable } from '@nestjs/common';
import type { StorageAdapter, UploadSession } from './storage-adapter.js';

type Session = UploadSession & { byteSize: bigint; mediaType: string; completed: boolean; revoked: boolean; content: Buffer };

@Injectable()
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly sessions = new Map<string, Session>();

  beginUpload(input: { documentId: string; mediaType: string; byteSize: bigint }): Promise<UploadSession> {
    const storageKey = `memory/${input.documentId}/${randomUUID()}`;
    // The token is opaque to the API consumer but deliberately stable for a
    // replay of the same idempotent command. The production adapter may use a
    // signed token while preserving the same stability guarantee.
    const uploadToken = storageKey;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    this.sessions.set(storageKey, { storageKey, uploadToken, expiresAt, byteSize: input.byteSize, mediaType: input.mediaType, completed: false, revoked: false, content: Buffer.alloc(0) });
    return Promise.resolve({ storageKey, uploadToken, expiresAt });
  }

  completeUpload(storageKey: string, _checksumSha256: string, byteSize: bigint): Promise<void> {
    const session = this.sessions.get(storageKey);
    if (!session || session.revoked) return Promise.reject(new NotFoundException('Upload session not found'));
    if (session.expiresAt.getTime() < Date.now()) return Promise.reject(new ConflictException('Upload session expired'));
    if (session.byteSize !== byteSize) return Promise.reject(new ConflictException('Uploaded byte size does not match the declared size'));
    session.completed = true;
    return Promise.resolve();
  }

  readStream(storageKey: string): Promise<Readable> {
    const session = this.sessions.get(storageKey);
    if (!session || !session.completed || session.revoked) return Promise.reject(new NotFoundException('Document content unavailable'));
    return Promise.resolve(Readable.from(session.content));
  }

  revoke(storageKey: string): Promise<void> {
    const session = this.sessions.get(storageKey);
    if (session) session.revoked = true;
    return Promise.resolve();
  }
}
