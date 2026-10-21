import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../src/database/database.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { EventModule } from '../../src/events/event.module.js';
import { OutboxWriterModule } from '../../src/events/outbox-writer.module.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';
import { IntelligenceConsumer } from '../../src/intelligence/intelligence.consumer.js';
import { IntelligenceProjectionModule } from '../../src/intelligence/intelligence-projection.module.js';
import { IntelligenceProjectionService } from '../../src/intelligence/intelligence-projection.service.js';
import { MetricCalculatorService } from '../../src/intelligence/metric-calculator.service.js';

describe('IntelligenceProjectionModule runtime injection', () => {
  it('resolves the projection service, calculator, and consumer through Nest metadata', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, EventModule, IntelligenceProjectionModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get(MetricCalculatorService)).toBeInstanceOf(MetricCalculatorService);
    expect(moduleRef.get(IntelligenceProjectionService)).toBeInstanceOf(IntelligenceProjectionService);
    expect(moduleRef.get(IntelligenceConsumer)).toBeInstanceOf(IntelligenceConsumer);
    const sharedOutbox = moduleRef.select(OutboxWriterModule).get(PrismaOutboxWriter, { strict: true });
    expect(moduleRef.select(IntelligenceProjectionModule).get(PrismaOutboxWriter)).toBe(sharedOutbox);
    expect(moduleRef.select(EventModule).get(PrismaOutboxWriter)).toBe(sharedOutbox);
    await moduleRef.close();
  });
});
