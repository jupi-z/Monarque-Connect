import { Module } from '@nestjs/common';
import { OutboxWriterModule } from '../events/outbox-writer.module.js';
import { IntelligenceConsumer } from './intelligence.consumer.js';
import { IntelligenceProjectionService } from './intelligence-projection.service.js';
import { MetricCalculatorService } from './metric-calculator.service.js';

@Module({
  imports: [OutboxWriterModule],
  providers: [MetricCalculatorService, IntelligenceProjectionService, IntelligenceConsumer],
  exports: [MetricCalculatorService, IntelligenceProjectionService, IntelligenceConsumer],
})
export class IntelligenceProjectionModule {}
