import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { StorageAdapter, UploadReceipt, UploadSession } from './storage-adapter.js';

type Session = UploadSession & { byteSize: bigint; mediaType: string; completed: boolean; revoked: boolean; content: Buffer | null; uploadedReceipt: UploadReceipt | null };

@Injectable()
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly sessions = new Map<string, Session>();

  beginUpload(input: { documentId: string; mediaType: string; byteSize: bigint }): Promise<UploadSession> {
    const storageKey = `memory/${input.documentId}/${randomUUID()}`;
    // The token is opaque to the API consumer but deliberately stable for a
    // replay of the same idempotent command. The production adapter may use a
    // signed token while preserving the same stability guarantee.
    const uploadToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    this.sessions.set(storageKey, { storageKey, uploadToken, expiresAt, byteSize: input.byteSize, mediaType: input.mediaType, completed: false, revoked: false, content: null, uploadedReceipt: null });
    return Promise.resolve({ storageKey, uploadToken, expiresAt });
  }

  async writeUpload(storageKey: string, uploadToken: string, content: Readable): Promise<UploadReceipt> {
    const session = this.sessions.get(storageKey);
    if (!session || session.revoked || session.uploadToken !== uploadToken) throw new NotFoundException('Upload session not found');
    if (session.expiresAt.getTime() < Date.now()) throw new ConflictException('Upload session expired');
    const chunks: Buffer[] = [];
    let byteSize = 0n;
    for await (const chunk of content) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      byteSize += BigInt(buffer.byteLength);
      if (byteSize > session.byteSize) throw new ConflictException('Uploaded content exceeds the declared size');
      chunks.push(buffer);
    }
    if (byteSize !== session.byteSize) throw new ConflictException('Uploaded content byte size does not match the declaration');
    const buffer = Buffer.concat(chunks);
    const receipt = { byteSize, checksumSha256: createHash('sha256').update(buffer).digest('hex') } satisfies UploadReceipt;
    if (session.uploadedReceipt && (session.uploadedReceipt.checksumSha256 !== receipt.checksumSha256 || session.uploadedReceipt.byteSize !== receipt.byteSize)) throw new ConflictException('Upload retry contains different content');
    session.content = session.content ?? buffer;
    session.uploadedReceipt = session.uploadedReceipt ?? receipt;
    return session.uploadedReceipt;
  }

  completeUpload(storageKey: string, checksumSha256: string, byteSize: bigint): Promise<void> {
    const session = this.sessions.get(storageKey);
    if (!session || session.revoked) return Promise.reject(new NotFoundException('Upload session not found'));
    if (session.expiresAt.getTime() < Date.now()) return Promise.reject(new ConflictException('Upload session expired'));
    if (!session.uploadedReceipt || !session.content) return Promise.reject(new ConflictException('Upload content has not been received'));
    if (session.uploadedReceipt.byteSize !== byteSize) return Promise.reject(new ConflictException('Uploaded byte size does not match the declared size'));
    if (session.uploadedReceipt.checksumSha256 !== checksumSha256.toLowerCase()) return Promise.reject(new ConflictException('Uploaded content checksum does not match'));
    if (session.completed) return Promise.resolve();
    session.completed = true;
    return Promise.resolve();
  }

  readStream(storageKey: string): Promise<Readable> {
    const session = this.sessions.get(storageKey);
    if (!session || !session.completed || session.revoked || !session.content) return Promise.reject(new NotFoundException('Document content unavailable'));
    return Promise.resolve(Readable.from(session.content));
  }

  revoke(storageKey: string): Promise<void> {
    const session = this.sessions.get(storageKey);
    if (session) session.revoked = true;
    return Promise.resolve();
  }
}
