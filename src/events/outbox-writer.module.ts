import { Module } from '@nestjs/common';
import { PrismaOutboxWriter } from './prisma-outbox.writer.js';

@Module({
  providers: [PrismaOutboxWriter],
  exports: [PrismaOutboxWriter],
})
export class OutboxWriterModule {}
