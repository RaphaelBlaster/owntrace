import { isIP } from 'node:net'

function integer(name, fallback, min, max) {
  const value = process.env[name]?.trim()
  const number = value ? Number(value) : fallback
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer from ${min} to ${max}`)
  return number
}
export function getTraceExecutionConfig({ service = false, remote = false } = {}) {
  const mode = process.env.TRACE_EXECUTION_MODE?.trim() || 'local'
  if (!['local', 'remote'].includes(mode)) throw new Error('TRACE_EXECUTION_MODE must be local or remote')
  const maxConcurrent = integer('TRACE_MAX_CONCURRENT', 4, 1, 64)
  const port = integer('TRACE_SERVICE_PORT', 5001, 1, 65535)
  const host = process.env.TRACE_SERVICE_HOST?.trim() || '127.0.0.1'
  if (!['127.0.0.1', '0.0.0.0', '::1'].includes(host)) throw new Error('TRACE_SERVICE_HOST must be a loopback or container bind address')
  if (mode === 'local' && !service && !remote) return { mode, maxConcurrent, port, host }
  const token = process.env.TRACE_SERVICE_TOKEN?.trim()
  if (!token || token.length < 32 || /\s/.test(token)) throw new Error('TRACE_SERVICE_TOKEN must contain at least 32 non-whitespace characters')
  let url
  if (!service) {
    try { url = new URL(process.env.TRACE_SERVICE_URL) } catch { throw new Error('TRACE_SERVICE_URL must be a private HTTP(S) origin') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('TRACE_SERVICE_URL must be a private HTTP(S) origin')
    const host = url.hostname
    // Private transport only. Network/DNS policy must also keep this origin internal.
    const privateIPv4 = isIP(host) === 4 && (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host))
    if (!(host === 'localhost' || host === '[::1]' || host === 'owntrace-trace' || privateIPv4)) throw new Error('TRACE_SERVICE_URL must use an approved private host')
  }
  return { mode, maxConcurrent, port, host, token, url: url?.origin }
}

export function orderWorkerEnabled() {
  const value = process.env.ORDER_WORKER_ENABLED?.trim() || 'true'
  if (!['true', 'false'].includes(value)) throw new Error('ORDER_WORKER_ENABLED must be true or false')
  return value === 'true'
}
