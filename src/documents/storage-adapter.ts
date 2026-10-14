import type { Readable } from 'node:stream';

export interface UploadSession {
  storageKey: string;
  uploadToken: string;
  expiresAt: Date;
}

export interface StorageAdapter {
  beginUpload(input: { documentId: string; mediaType: string; byteSize: bigint }): Promise<UploadSession>;
  completeUpload(storageKey: string, checksumSha256: string, byteSize: bigint): Promise<void>;
  readStream(storageKey: string): Promise<Readable>;
  revoke(storageKey: string): Promise<void>;
}
