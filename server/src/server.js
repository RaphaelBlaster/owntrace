import 'dotenv/config'
import mongoose from 'mongoose'
import { MailAnalysis, MailInsight } from './models/mail-insight.model.js'
import { getRuntimeConfig, validateRuntimeEnvironment } from './config/runtime.js'
import { getOwntraceRole, getWorkerHealthHost, roleRunsWorkers, roleServesApi } from './config/role.js'
import connectDatabase from './config/db.js'
import { logEvent } from './utils/logger.js'
import { closeOrderWriteBuffer } from './services/order-write-buffer.service.js'
import { createWorkerHealthServer, startBackgroundWorkers } from './worker.js'
import { closeQueues } from './shared/queue.js'

let httpServer
let isShuttingDown = false
let stopBackgroundWorkers
let role = 'all'
let startup

async function shutdown(signal, exitCode = 0) {
  if (isShuttingDown) return
  isShuttingDown = true
  const { shutdownTimeoutMs } = getRuntimeConfig()
  logEvent('info', 'server_shutdown_started', { signal, role })

  const forceExit = setTimeout(() => {
    logEvent('error', 'server_shutdown_timeout', { signal, role })
    process.exit(1)
  }, shutdownTimeoutMs)
  forceExit.unref()

  try {
    // A signal during startup waits for the loops it already started, so they
    // are stopped (and their leases released) instead of orphaned by exit.
    await startup?.catch(() => {})
    // Stop request and scan producers before draining buffered writes.
    if (httpServer) {
      const closed = new Promise((resolve) => httpServer.close(resolve))
      httpServer.closeIdleConnections?.()
      await closed
    }
    if (stopBackgroundWorkers) await stopBackgroundWorkers()
    // The web role only enqueues buffered writes; close its producer connection.
    else await closeOrderWriteBuffer()
    // Closes BullMQ producers (web/api) and connections; no-op without REDIS_URL.
    await closeQueues()
    await mongoose.disconnect()
  } catch (error) {
    logEvent('error', 'server_shutdown_failed', { signal, role, errorName: error?.name || 'Error' })
    exitCode = 1
  }
  clearTimeout(forceExit)
  logEvent('info', 'server_shutdown_completed', { signal, role })
  process.exit(exitCode)
}

async function startServer() {
  role = getOwntraceRole()
  const runtime = validateRuntimeEnvironment()
  await connectDatabase()
  await Promise.all([MailAnalysis.init(), MailInsight.init()])
  if (isShuttingDown) return
  if (roleRunsWorkers(role)) stopBackgroundWorkers = await startBackgroundWorkers()
  if (isShuttingDown) return

  if (roleServesApi(role)) {
    // Loaded only when serving the API, so the worker role never builds routes.
    const { default: app } = await import('./app.js')
    httpServer = app.listen(runtime.port, () => {
      logEvent('info', 'server_started', { port: runtime.port, role })
    })
    httpServer.requestTimeout = 30_000
    httpServer.headersTimeout = 35_000
    httpServer.keepAliveTimeout = 5_000
  } else {
    httpServer = createWorkerHealthServer()
    httpServer.listen(runtime.port, getWorkerHealthHost(), () => {
      logEvent('info', 'worker_started', { port: runtime.port, role })
    })
  }
}

startup = startServer()
startup.catch((error) => {
  logEvent('error', 'server_start_failed', { errorName: error.name, role })
  process.exit(1)
})

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('message', (message) => {
  if (message === 'owntrace:shutdown') shutdown('IPC')
})
process.on('unhandledRejection', (error) => {
  logEvent('error', 'unhandled_rejection', { errorName: error?.name || 'Error' })
  shutdown('unhandledRejection', 1)
})
process.on('uncaughtException', (error) => {
  logEvent('error', 'uncaught_exception', { errorName: error?.name || 'Error' })
  shutdown('uncaughtException', 1)
})
