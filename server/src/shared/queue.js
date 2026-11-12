import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { logEvent } from '../utils/logger.js'

// BullMQ queue for the split mail pipeline. Only used when REDIS_URL is set;
// without it every caller keeps its existing inline/Mongo-lease path.
// Mongo job documents and leases stay the source of truth; a BullMQ job only
// says "look at this user now" and finishes once the Mongo sync is queued.
export const MAIL_SYNC = 'mail-sync'

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  // Failed jobs stay inspectable but bounded (redis runs with noeviction).
  removeOnFail: { age: 7 * 86400, count: 1000 },
}

let producerConnection, workerConnection
const queues = new Map()
const workers = new Set()

export function redisQueueEnabled() { return Boolean(process.env.REDIS_URL?.trim()) }

// Producers fail fast so a webhook falls back to the inline path instead of
// hanging while Redis is down. Only Worker connections need
// maxRetriesPerRequest: null.
function getProducerConnection() {
  producerConnection ||= new IORedis(process.env.REDIS_URL.trim(), { enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 2000 })
  return producerConnection
}

function getWorkerConnection() {
  workerConnection ||= new IORedis(process.env.REDIS_URL.trim(), { maxRetriesPerRequest: null, connectTimeout: 5000 })
  return workerConnection
}

function getQueue(name) {
  if (!queues.has(name)) queues.set(name, new Queue(name, { connection: getProducerConnection(), defaultJobOptions }))
  return queues.get(name)
}

// dedupeId collapses adds only while a job with that id is waiting or running;
// once it completes or fails, the next add creates a new job. BullMQ waits for
// the connection to be ready before adding, so a hard 2s cap keeps webhooks
// answering fast while Redis is down.
export async function enqueue(name, data, { dedupeId } = {}) {
  let timer
  const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Redis enqueue timed out')), 2000) })
  try { return await Promise.race([getQueue(name).add(name, data, dedupeId ? { deduplication: { id: String(dedupeId) } } : {}), timeout]) }
  finally { clearTimeout(timer) }
}

export function startWorker(name, processor, opts = {}) {
  const worker = new Worker(name, async (job) => processor(job.data, job), { connection: getWorkerConnection(), concurrency: 4, ...opts })
  worker.on('error', (error) => logEvent('warn', 'queue_worker_error', { queue: name, errorName: error?.name || 'Error' }))
  workers.add(worker)
  return async () => { workers.delete(worker); await worker.close() }
}

export async function closeQueues() {
  await Promise.allSettled([...workers].map((worker) => worker.close()))
  workers.clear()
  await Promise.allSettled([...queues.values()].map((queue) => queue.close()))
  queues.clear()
  const current = [producerConnection, workerConnection].filter(Boolean)
  producerConnection = workerConnection = undefined
  await Promise.allSettled(current.map((redis) => redis.quit().catch(() => redis.disconnect())))
}
