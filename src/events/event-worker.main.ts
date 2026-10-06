import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { EventDispatcher } from './event-dispatcher.js';
import { EventWorker } from './event-worker.js';
import { FoundationProbeConsumer } from './foundation-probe.consumer.js';
import { OutboxRepository } from './outbox.repository.js';
import { JsonEventWorkerObserver } from './event-observability.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for the event worker');

const pool = new Pool({ connectionString, max: 5 });
const repository = new OutboxRepository();
const consumer = new FoundationProbeConsumer();
const dispatcher = new EventDispatcher();
dispatcher.register(consumer.consumerName, 'foundation.probe.recorded', 1, consumer.handle.bind(consumer));
const worker = new EventWorker(pool, repository, dispatcher, new JsonEventWorkerObserver());
let stopping = false;
let activeBatch: Promise<number> | undefined;
let stopPromise: Promise<void> | undefined;

async function stop(): Promise<void> {
  if (stopPromise) return stopPromise;
  stopping = true;
  stopPromise = (async () => {
    if (activeBatch) await activeBatch;
    await pool.end();
  })();
  await stopPromise;
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

while (!stopping) {
  try {
    activeBatch = worker.processBatch();
    await activeBatch;
  } catch {
    console.error(JSON.stringify({ code: 'EVENT_WORKER_CYCLE_FAILED' }));
  } finally {
    activeBatch = undefined;
  }
  if (!stopping) await delay(1000);
}
