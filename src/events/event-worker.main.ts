import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { EventDispatcher } from './event-dispatcher.js';
import { EventWorker } from './event-worker.js';
import { FoundationProbeConsumer } from './foundation-probe.consumer.js';
import { OutboxRepository } from './outbox.repository.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for the event worker');

const pool = new Pool({ connectionString, max: 5 });
const repository = new OutboxRepository();
const consumer = new FoundationProbeConsumer();
const dispatcher = new EventDispatcher();
dispatcher.register('foundation.probe.recorded', 1, consumer.handle.bind(consumer));
const worker = new EventWorker(pool, repository, dispatcher);
let stopping = false;

async function stop(): Promise<void> {
  stopping = true;
  await pool.end();
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

while (!stopping) {
  try {
    await worker.processBatch();
  } catch (error) {
    console.error('Event worker cycle failed', error instanceof Error ? error.message : 'unknown error');
  }
  if (!stopping) await delay(1000);
}
