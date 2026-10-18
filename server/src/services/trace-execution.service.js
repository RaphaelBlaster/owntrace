import { once } from 'node:events'
import { getTraceExecutionConfig } from '../config/trace-execution.js'
import { answerTrace } from './trace-assistant.service.js'
import AppError from '../utils/app-error.js'

const MAX_FRAME_BYTES = 512 * 1024
const MAX_STREAM_BYTES = 2 * 1024 * 1024
let activeLocal = 0
const unavailable = () => new AppError('TRACE processing is unavailable. Please retry shortly.', 503, 'TRACE_SERVICE_UNAVAILABLE')
const invalid = () => new AppError('TRACE processing returned an invalid response. Please retry.', 502, 'TRACE_SERVICE_PROTOCOL')

// The engine's synchronous callbacks cannot await drain. Bound buffering and cancel
// slow consumers instead of allowing provider output to grow without limit.
export function writeTraceFrame(response, value, signal) {
  signal.throwIfAborted()
  if (response.destroyed || response.writableEnded) throw new DOMException('Stopped', 'AbortError')
  const text = `${JSON.stringify(value)}\n`
  if (Buffer.byteLength(text) > MAX_FRAME_BYTES || response.writableLength + Buffer.byteLength(text) > MAX_FRAME_BYTES) throw new AppError('TRACE output exceeded streaming capacity. Please retry.', 503, 'TRACE_STREAM_CAPACITY')
  response.write(text)
}

export async function waitForTraceDrain(response, signal) {
  if (response.destroyed || response.writableEnded) throw new DOMException('Stopped', 'AbortError')
  if (response.writableNeedDrain) await once(response, 'drain', { signal })
}

export async function requestRemoteTrace(job, cookie, signal, onEvent, waitForOutput) {
  const config = getTraceExecutionConfig({ remote: true })
  if (!config.url || !config.token) throw unavailable()
  let response, reader
  try {
    response = await fetch(`${config.url}/internal/trace/answer`, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${config.token}`, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    })
    if (!response.ok) {
      // Private endpoint errors have a bounded body, but do not trust arbitrary
      // upstream error text or parse an unbounded response.json().
      const data = await readError(response, signal)
      if (data && /^TRACE_[A-Z_]+$/.test(data.code) && typeof data.message === 'string' && data.message.length <= 500) throw new AppError(data.message, response.status, data.code)
      throw unavailable()
    }
    if (!response.headers.get('content-type')?.includes('application/x-ndjson') || !response.body) throw invalid()
    reader = response.body.getReader()
    const decoder = new TextDecoder(); let buffer = '', bytes = 0, result, complete = false
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_STREAM_BYTES) throw invalid()
      buffer += decoder.decode(value, { stream: true })
      let boundary
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1)
        if (Buffer.byteLength(line) > MAX_FRAME_BYTES || complete) throw invalid()
        let event; try { event = JSON.parse(line) } catch { throw invalid() }
        if (event.type === 'error') {
          if (!/^TRACE_[A-Z_]+$/.test(event.code) || typeof event.message !== 'string' || event.message.length > 500 || !Number.isInteger(event.statusCode) || event.statusCode < 400 || event.statusCode > 599) throw invalid()
          throw new AppError(event.message, event.statusCode, event.code)
        }
        if (event.type === 'complete') {
          if (event.data?.role !== 'assistant' || typeof event.data.content !== 'string' || event.data.content.length > 16000 || !Array.isArray(event.data.sources) || !Array.isArray(event.data.actions) || !Array.isArray(event.data.grounding)) throw invalid()
          result = event.data; complete = true
        } else if (['status', 'delta'].includes(event.type) && typeof event.data?.text === 'string' && event.data.text.length <= 16000) {
          await onEvent?.(event.type, event.data)
          await waitForOutput?.()
        } else throw invalid()
      }
      if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) throw invalid()
    }
    if (!complete || buffer.trim()) throw invalid()
    return result
  } catch (error) {
    if (signal.aborted) throw signal.reason || new DOMException('Stopped', 'AbortError')
    if (error instanceof AppError) throw error
    throw unavailable()
  } finally {
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() }
    else await response?.body?.cancel().catch(() => {})
  }
}
async function readError(response, signal) {
  if (!response.body) return null
  const reader = response.body.getReader(); let text = '', bytes = 0
  try {
    const decoder = new TextDecoder()
    while (true) {
      signal.throwIfAborted(); const {done,value}=await reader.read(); if(done)break
      bytes+=value.byteLength; if(bytes>4096)return null
      text+=decoder.decode(value,{stream:true})
    }
    try { return JSON.parse(text) } catch { return null }
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock() }
}
export async function executeTrace({ job, cookie, userId, history, content, signal, onEvent, checkConsent, providerConfig, responseDetail, waitForOutput }) {
  const config = getTraceExecutionConfig()
  if (config.mode === 'remote') return requestRemoteTrace(job, cookie, signal, onEvent, waitForOutput)
  if (activeLocal >= config.maxConcurrent) throw new AppError('TRACE is at capacity. Please retry shortly.', 503, 'TRACE_CAPACITY')
  activeLocal++
  try { return await answerTrace(userId, history, content, signal, onEvent, checkConsent, providerConfig, responseDetail) }
  finally { activeLocal-- }
}
