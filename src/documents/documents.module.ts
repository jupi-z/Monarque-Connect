import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { DocumentService } from './document.service.js';
import { DocumentsController } from './documents.controller.js';
import { MemoryStorageAdapter } from './memory-storage.adapter.js';
import { STORAGE_ADAPTER } from './storage-adapter.js';

export function createDocumentStorageAdapter(): MemoryStorageAdapter {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const adapter = process.env.DOCUMENT_STORAGE_ADAPTER ?? (nodeEnv === 'test' || nodeEnv === 'development' ? 'memory' : undefined);
  if (adapter !== 'memory' || (nodeEnv !== 'test' && nodeEnv !== 'development')) {
    throw new Error('A real document storage adapter must be configured; MemoryStorageAdapter is test-only');
  }
  return new MemoryStorageAdapter();
}

@Module({
  imports: [AuthModule, EventModule, TenancyModule],
  controllers: [DocumentsController],
  providers: [
    {
      provide: STORAGE_ADAPTER,
      useFactory: createDocumentStorageAdapter,
    },
    DocumentService,
  ],
  exports: [DocumentService],
})
export class DocumentsModule {}
