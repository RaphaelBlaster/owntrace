import http from 'node:http'
import mongoose from 'mongoose'
import { startTopKWorker } from './services/top-k.service.js'
import { initializeOrderStorage, startOrderWorker } from './services/order-scan.service.js'
import { orderWriteBufferEnabled } from './config/order-write-buffer.js'
import { startOrderWriteBufferWorker } from './services/order-write-buffer.service.js'
import { orderWorkerEnabled } from './config/trace-execution.js'
import { startMailSyncWorker } from './services/mail-sync-worker.service.js'

// Starts every background loop (mail sync + push replay + watch renewal +
// safety poll, Top K, order scans, order write buffer drain) and returns one
// idempotent stop function that drains them in the order the monolith always
// used: producers first, buffered writes last.
export async function startBackgroundWorkers() {
  const stops = {}
  stops.mailSync = startMailSyncWorker()
  stops.topK = startTopKWorker()
  let stopping
  function stopBackgroundWorkers() {
    stopping ||= (async () => {
      if (stops.order) await stops.order()
      if (stops.mailSync) await stops.mailSync()
      if (stops.topK) await stops.topK()
      if (stops.writeBuffer) await stops.writeBuffer()
    })()
    return stopping
  }
  try {
    if (orderWorkerEnabled()) {
      await initializeOrderStorage()
      stops.order = startOrderWorker()
    }
    // Sanitized derived metadata is drained even when scan polling is disabled,
    // because Gmail/Outlook metadata sync pages also write through the buffer.
    if (orderWriteBufferEnabled()) stops.writeBuffer = startOrderWriteBufferWorker()
  } catch (error) {
    // Never leave the already-started loops running behind a failed start.
    await stopBackgroundWorkers().catch(() => {})
    throw error
  }
  return stopBackgroundWorkers
}

// Worker role health listener: answers only the two health paths the image
// HEALTHCHECK already uses and 404s everything else, so no API is exposed.
export function createWorkerHealthServer({ isReady = () => mongoose.connection.readyState === 1 } = {}) {
  const server = http.createServer((request, response) => {
    const path = (request.url || '').split('?')[0].replace(/\/+$/, '')
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body))
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, { success: false })
    if (path === '/api/health') return send(200, { success: true, role: 'worker' })
    if (path === '/api/health/ready') {
      const ready = isReady()
      return send(ready ? 200 : 503, { success: ready, status: ready ? 'ready' : 'not_ready' })
    }
    return send(404, { success: false })
  })
  server.requestTimeout = 5_000
  server.headersTimeout = 5_000
  server.keepAliveTimeout = 1_000
  return server
}
