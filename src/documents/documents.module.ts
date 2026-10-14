import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { DocumentService } from './document.service.js';
import { DocumentsController } from './documents.controller.js';
import { MemoryStorageAdapter } from './memory-storage.adapter.js';

@Module({
  imports: [AuthModule, EventModule, TenancyModule],
  controllers: [DocumentsController],
  providers: [MemoryStorageAdapter, DocumentService],
  exports: [DocumentService],
})
export class DocumentsModule {}
