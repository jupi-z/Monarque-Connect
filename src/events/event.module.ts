import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventDatabase } from './event-database.js';
import { EventDispatcher } from './event-dispatcher.js';
import { EventWorker } from './event-worker.js';
import { FoundationProbeConsumer } from './foundation-probe.consumer.js';
import { FoundationProbeService } from './foundation-probe.service.js';
import { OutboxRepository } from './outbox.repository.js';

function createDispatcher(consumer: FoundationProbeConsumer): EventDispatcher {
  const dispatcher = new EventDispatcher();
  dispatcher.register('foundation.probe.recorded', 1, consumer.handle.bind(consumer));
  return dispatcher;
}

@Module({
  imports: [ConfigModule],
  providers: [
    EventDatabase,
    OutboxRepository,
    FoundationProbeConsumer,
    FoundationProbeService,
    {
      provide: EventDispatcher,
      inject: [FoundationProbeConsumer],
      useFactory: createDispatcher,
    },
    {
      provide: EventWorker,
      inject: [EventDatabase, OutboxRepository, EventDispatcher],
      useFactory: (database: EventDatabase, repository: OutboxRepository, dispatcher: EventDispatcher) =>
        new EventWorker(database.pool, repository, dispatcher),
    },
  ],
  exports: [EventDatabase, OutboxRepository, FoundationProbeService, EventDispatcher, EventWorker],
})
export class EventModule {}
