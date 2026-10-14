import type { Readable } from 'node:stream';

export interface UploadSession {
  storageKey: string;
  uploadToken: string;
  expiresAt: Date;
}

export interface UploadReceipt {
  byteSize: bigint;
  checksumSha256: string;
}

export interface StorageAdapter {
  beginUpload(input: { documentId: string; mediaType: string; byteSize: bigint }): Promise<UploadSession>;
  writeUpload(storageKey: string, uploadToken: string, content: Readable): Promise<UploadReceipt>;
  completeUpload(storageKey: string, checksumSha256: string, byteSize: bigint): Promise<void>;
  readStream(storageKey: string): Promise<Readable>;
  revoke(storageKey: string): Promise<void>;
}

export const STORAGE_ADAPTER = 'DOCUMENT_STORAGE_ADAPTER';
