// Derived email-metadata writes are buffered in Redis before Mongo. Redis is a
// private same-host buffer only; it never carries message bodies or tokens.
const approvedHosts = new Set(['localhost', '127.0.0.1', '::1', 'owntrace-redis'])

function integer(name, fallback, min, max) {
  const value = process.env[name]?.trim()
  const number = value ? Number(value) : fallback
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer from ${min} to ${max}`)
  return number
}
export function orderWriteBufferEnabled() { return Boolean(process.env.ORDER_REDIS_URL?.trim()) }
export function getOrderWriteBufferConfig() {
  const raw = process.env.ORDER_REDIS_URL?.trim()
  // Blank keeps the existing behaviour: batched upserts go straight to Mongo.
  if (!raw) return null
  let url
  try { url = new URL(raw) } catch { throw new Error('ORDER_REDIS_URL must be a same-host redis:// or rediss:// URL') }
  if (!['redis:', 'rediss:'].includes(url.protocol) || url.search || url.hash) throw new Error('ORDER_REDIS_URL must be a same-host redis:// or rediss:// URL')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // Managed endpoints such as ElastiCache are rejected: Redis shares the app host.
  if (!approvedHosts.has(host)) throw new Error('ORDER_REDIS_URL must point at localhost or the same-host owntrace-redis service')
  const port = Number(url.port || 6379)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ORDER_REDIS_URL must use a valid port')
  const path = url.pathname.replace(/^\/+/, '')
  const db = path ? Number(path) : 0
  if (!Number.isInteger(db) || db < 0 || db > 15) throw new Error('ORDER_REDIS_URL database must be an integer from 0 to 15')
  const connection = { host, port, db, maxRetriesPerRequest: null, enableOfflineQueue: false, retryStrategy: attempt => Math.min(attempt * 500, 5000) }
  if (url.password) { connection.password = decodeURIComponent(url.password); if (url.username) connection.username = decodeURIComponent(url.username) }
  if (url.protocol === 'rediss:') connection.tls = {}
  return {
    streamKey: 'owntrace:order-writes',
    group: 'owntrace-writers',
    // One consumer per process so a dead consumer's entries can be reclaimed.
    consumer: `owntrace-${process.pid}`,
    connection,
    batchSize: integer('ORDER_WRITE_BUFFER_BATCH_SIZE', 200, 1, 1000),
    blockMs: integer('ORDER_WRITE_BUFFER_BLOCK_MS', 2000, 100, 30000),
    claimIdleMs: integer('ORDER_WRITE_BUFFER_CLAIM_IDLE_MS', 60000, 5000, 600000),
    retryDelayMs: integer('ORDER_WRITE_BUFFER_RETRY_DELAY_MS', 1000, 100, 30000),
    maxBatchFailures: integer('ORDER_WRITE_BUFFER_MAX_BATCH_FAILURES', 3, 1, 20),
  }
}
