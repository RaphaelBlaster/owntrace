import 'dotenv/config'
import mongoose from 'mongoose'
import { getJwtSecret } from './config/auth.js'
import { getTraceExecutionConfig } from './config/trace-execution.js'
import connectDatabase from './config/db.js'
import { createTraceService } from './trace-service.js'
import { getTraceProviderConfig } from './services/trace-provider.service.js'
import { getTraceDecisionProvider } from './services/trace-decision-config.js'
import { logEvent } from './utils/logger.js'

let app, server, stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  const force = setTimeout(() => process.exit(1), 10000); force.unref()
  app?.locals.stopTrace()
  if (server) await new Promise(resolve => server.close(resolve))
  await mongoose.disconnect(); clearTimeout(force)
}
async function start() {
  const config = getTraceExecutionConfig({ service: true })
  getJwtSecret(); getTraceProviderConfig()
  if (getTraceDecisionProvider() === 'typesafe' && !process.env.TYPESAFE_API_KEY?.trim()) throw new Error('TypeSafe must be configured for TRACE decisions')
  // A separate process gets a separate Mongo pool; keep its footprint bounded.
  await connectDatabase({ maxPoolSize: 5, serverSelectionTimeoutMS: 5000 })
  app = createTraceService()
  // This entrypoint deliberately imports no web app and starts no scan timer.
  server = app.listen(config.port, config.host, () => logEvent('info','trace_service_started',{port:config.port}))
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000
  server.on('error', () => { logEvent('error','trace_service_listen_failed',{}); shutdown().finally(()=>process.exit(1)) })
}
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => shutdown().catch(()=>process.exit(1)))
for (const event of ['unhandledRejection','uncaughtException']) process.on(event, () => {
  logEvent('error','trace_service_unexpected_failure',{event}); shutdown().finally(()=>process.exit(1))
})
start().catch(() => { logEvent('error','trace_service_start_failed',{}); shutdown().finally(()=>process.exit(1)) })
