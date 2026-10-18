import 'dotenv/config'
import mongoose from 'mongoose'
import app from './app.js'
import { getRuntimeConfig, validateRuntimeEnvironment } from './config/runtime.js'
import connectDatabase from './config/db.js'
import { logEvent } from './utils/logger.js'
import { initializeOrderStorage, startOrderWorker } from './services/order-scan.service.js'
import { orderWorkerEnabled } from './config/trace-execution.js'

let httpServer
let isShuttingDown = false
let stopOrderWorker

async function shutdown(signal, exitCode = 0) {
  if (isShuttingDown) return
  isShuttingDown = true
  const { shutdownTimeoutMs } = getRuntimeConfig()
  logEvent('info', 'server_shutdown_started', { signal })

  const forceExit = setTimeout(() => {
    logEvent('error', 'server_shutdown_timeout', { signal })
    process.exit(1)
  }, shutdownTimeoutMs)
  forceExit.unref()

  if (stopOrderWorker) await stopOrderWorker()
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve))
  }
  await mongoose.disconnect()
  clearTimeout(forceExit)
  logEvent('info', 'server_shutdown_completed', { signal })
  process.exit(exitCode)
}

async function startServer() {
  const runtime = validateRuntimeEnvironment()
  await connectDatabase()
  if (orderWorkerEnabled()) {
    await initializeOrderStorage()
    stopOrderWorker = startOrderWorker()
  }

  httpServer = app.listen(runtime.port, () => {
    logEvent('info', 'server_started', { port: runtime.port })
  })
  httpServer.requestTimeout = 30_000
  httpServer.headersTimeout = 35_000
  httpServer.keepAliveTimeout = 5_000
}

startServer().catch((error) => {
  logEvent('error', 'server_start_failed', { errorName: error.name })
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
