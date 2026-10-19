import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventDatabase } from './event-database.js';
import { EventDispatcher } from './event-dispatcher.js';
import { EventWorker } from './event-worker.js';
import { FoundationProbeConsumer } from './foundation-probe.consumer.js';
import { FoundationProbeService } from './foundation-probe.service.js';
import { OutboxRepository } from './outbox.repository.js';
import { PrismaOutboxWriter } from './prisma-outbox.writer.js';
import { PrismaFoundationProbeService } from './prisma-foundation-probe.service.js';
import { GoodsReceiptInventoryConsumer } from '../inventory/goods-receipt-inventory.consumer.js';
import { EventReceiptConsumer } from './event-receipt.consumer.js';

function createDispatcher(consumer: FoundationProbeConsumer, goodsReceiptInventory: GoodsReceiptInventoryConsumer, eventReceipt: EventReceiptConsumer): EventDispatcher {
  const dispatcher = new EventDispatcher();
  dispatcher.register(consumer.consumerName, 'foundation.probe.recorded', 1, consumer.handle.bind(consumer));
  dispatcher.register(goodsReceiptInventory.consumerName, 'purchases.goods_receipt.confirmed.v1', 1, goodsReceiptInventory.handle.bind(goodsReceiptInventory));
  dispatcher.register(goodsReceiptInventory.consumerName, 'purchases.goods_receipt.corrected.v1', 1, goodsReceiptInventory.handle.bind(goodsReceiptInventory));
  dispatcher.register(eventReceipt.consumerName, 'inventory.movement.created', 1, eventReceipt.handle.bind(eventReceipt));
  dispatcher.register(eventReceipt.consumerName, 'inventory.goods_receipt.assigned', 1, eventReceipt.handle.bind(eventReceipt));
  dispatcher.register(eventReceipt.consumerName, 'inventory.goods_receipt.imported', 1, eventReceipt.handle.bind(eventReceipt));
  for (const eventType of [
    'project.created.v1', 'project.updated.v1', 'project.status_changed.v1',
    'task.created.v1', 'task.updated.v1', 'task.status_changed.v1',
    'document.upload_started.v1', 'document.available.v1', 'document.linked.v1',
    'document.unlinked.v1', 'document.revoked.v1',
  ]) dispatcher.register(eventReceipt.consumerName, eventType, 1, eventReceipt.handle.bind(eventReceipt));
  for (const eventType of [
    'messaging.conversation.created.v1', 'messaging.conversation.suspended.v1', 'messaging.conversation.resumed.v1',
    'messaging.invitation.token_issued.v1',
    'messaging.organization_invitation.created.v1', 'messaging.organization_invitation.accepted.v1',
    'messaging.organization_invitation.declined.v1', 'messaging.organization_invitation.revoked.v1',
    'messaging.user_invitation.created.v1', 'messaging.user_invitation.accepted.v1',
    'messaging.user_invitation.declined.v1', 'messaging.user_invitation.revoked.v1',
    'messaging.participant.joined.v1', 'messaging.participant.left.v1', 'messaging.participant.revoked.v1',
    'messaging.message.sent.v1', 'messaging.relation.blocked.v1', 'messaging.relation.unblocked.v1',
    'messaging.abuse.threshold_exceeded.v1',
  ]) dispatcher.register(eventReceipt.consumerName, eventType, 1, eventReceipt.handle.bind(eventReceipt));
  return dispatcher;
}

@Module({
  imports: [ConfigModule],
  providers: [
    EventDatabase,
    OutboxRepository,
    PrismaOutboxWriter,
    PrismaFoundationProbeService,
    FoundationProbeConsumer,
    GoodsReceiptInventoryConsumer,
    { provide: EventReceiptConsumer, useValue: new EventReceiptConsumer('inventory-event-sink') },
    FoundationProbeService,
    {
      provide: EventDispatcher,
      inject: [FoundationProbeConsumer, GoodsReceiptInventoryConsumer, EventReceiptConsumer],
      useFactory: createDispatcher,
    },
    {
      provide: EventWorker,
      inject: [EventDatabase, OutboxRepository, EventDispatcher],
      useFactory: (database: EventDatabase, repository: OutboxRepository, dispatcher: EventDispatcher) =>
        new EventWorker(database.pool, repository, dispatcher),
    },
  ],
  exports: [EventDatabase, OutboxRepository, PrismaOutboxWriter, PrismaFoundationProbeService, FoundationProbeService, EventDispatcher, EventWorker],
})
export class EventModule {}
