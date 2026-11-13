import AppError from '../utils/app-error.js'
import { setTimeout as delay } from 'node:timers/promises'
import { logEvent } from '../utils/logger.js'

const isContentFilter = error => error?.code === 'content_filter' || error?.type === 'content_filter_error'
const filteredResponse = () => new AppError('The AI provider declined this request.', 422, 'TRACE_PROVIDER_CONTENT_FILTER')

async function requestCompletion(url, options) {
  for(let attempt=1;attempt<=2;attempt++) {
    options.signal.throwIfAborted()
    const response=await fetch(url,options)
    options.signal.throwIfAborted()
    if(response.ok)return response
    logEvent('warn','trace_completion_rejected',{attempt,providerStatus:response.status})
    const retryAfter=response.headers.get('retry-after')
    const seconds=retryAfter===null ? 1 : Number(retryAfter)
    if(attempt===2 || ![408,429,500,502,503,504].includes(response.status) || !Number.isFinite(seconds) || seconds<0 || seconds>2)return response
    await response.body?.cancel()
    await delay(Math.max(200,seconds*1000),undefined,{signal:options.signal})
  }
}

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback
}
// Turn/loop budgets. The previous hard-coded 45s turn, 400-token plan and 1800-token rounds
// truncated reasoning-capable deployments (finish_reason=length) before any tool call arrived.
function getTraceLimits() {
  const parallel = process.env.TRACE_PARALLEL_TOOL_CALLS?.trim()
  return {
    turnTimeoutMs: boundedInteger('TRACE_TURN_TIMEOUT_MS', 90_000, 15_000, 180_000),
    maxRounds: boundedInteger('TRACE_MAX_TOOL_ROUNDS', 7, 2, 12),
    maxCallsPerRound: boundedInteger('TRACE_MAX_TOOL_CALLS_PER_ROUND', 8, 1, 16),
    maxCalls: boundedInteger('TRACE_MAX_TOOL_CALLS', 20, 4, 40),
    planMaxTokens: boundedInteger('TRACE_PLAN_MAX_TOKENS', 1000, 200, 8000),
    maxTokens: boundedInteger('TRACE_MAX_COMPLETION_TOKENS', 4000, 500, 32000),
    // Omitted by default: some deployments (reasoning models) reject the parameter outright,
    // and the tool loop already answers several calls from one round.
    parallelToolCalls: parallel === 'true' ? true : parallel === 'false' ? false : undefined,
  }
}

function getTraceProviderName() {
  const provider = process.env.TRACE_PROVIDER?.trim() || 'inception'
  if (!['inception', 'azure'].includes(provider)) throw new AppError('Choose a supported TRACE AI provider.', 503, 'TRACE_NOT_CONFIGURED')
  return provider
}
function getTraceProviderConfig() {
  const provider = getTraceProviderName()
  if (provider === 'inception') {
    const key = process.env.INCEPTION_API_KEY?.trim()
    if (!key) throw new AppError('TRACE is waiting for its Inception AI connection. Configure INCEPTION_API_KEY on the server.', 503, 'TRACE_NOT_CONFIGURED')
    return { provider, label: 'Inception Labs', url: 'https://api.inceptionlabs.ai/v1/chat/completions', key, model: process.env.INCEPTION_MODEL?.trim() || 'mercury-2' }
  }
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim()
  const key = process.env.AZURE_OPENAI_API_KEY?.trim()
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT?.trim()
  if (!endpoint || !key || !deployment) throw new AppError('TRACE is waiting for its Azure AI connection. Configure the server endpoint, deployment and credential.', 503, 'TRACE_NOT_CONFIGURED')
  let url
  try {
    url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid endpoint')
    const base = url.pathname.replace(/\/$/, '')
    if (process.env.AZURE_OPENAI_API_VERSION) {
      url.pathname = `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions`
      url.searchParams.set('api-version', process.env.AZURE_OPENAI_API_VERSION)
    } else url.pathname = `${base.endsWith('/openai/v1') ? base : `${base}/openai/v1`}/chat/completions`
  } catch { throw new AppError('TRACE Azure endpoint configuration is invalid.', 503, 'TRACE_NOT_CONFIGURED') }
  return { provider, label: 'Azure OpenAI', url: url.href, key, model: deployment }
}

async function traceCompletion(messages, tools, signal, onText, pinnedConfig, options = {}) {
  const config = pinnedConfig || getTraceProviderConfig()
  const limits = getTraceLimits()
  const cap = options.maxTokens || limits.maxTokens
  // Only private tool-planning rounds tolerate truncation: their output is never streamed to the
  // user, so one retry with a larger cap cannot duplicate visible text. A final prose answer that
  // hits the cap still fails as before.
  const toolRound = Boolean(tools?.length)
  let result = await completeOnce(config, limits, messages, tools, signal, onText, options, cap, toolRound)
  if (result.finishReason === 'length' && toolRound) {
    const raisedCap = Math.min(32000, Math.max(cap * 2, cap + 1000))
    logEvent('warn', 'trace_completion_truncated', { maxTokens: cap, retryMaxTokens: raisedCap })
    signal.throwIfAborted()
    result = await completeOnce(config, limits, messages, tools, signal, onText, options, raisedCap, toolRound)
    // Still truncated: hand back a recoverable empty round instead of half-parsed tool calls.
    if (result.finishReason === 'length') return { role: 'assistant', content: null, truncated: true }
  }
  if (onText && !result.streamed && result.message.content) onText(result.message.content)
  return result.message
}
async function completeOnce(config, limits, messages, tools, signal, onText, options, maxTokens, tolerateLength) {
  let response
  try {
    response = await requestCompletion(config.url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...(config.provider === 'azure' ? { 'api-key': config.key } : {}), Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ model: config.model, messages, ...(tools?.length ? { tools, tool_choice: options.toolChoice || 'auto', ...(limits.parallelToolCalls === undefined ? {} : { parallel_tool_calls: limits.parallelToolCalls }) } : {}), max_completion_tokens: maxTokens, ...(config.provider === 'inception' ? { diffusing: false } : {}), ...(onText ? { stream: true } : {}) }),
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new AppError(`TRACE could not reach ${config.label}. Try again shortly.`, 502, 'TRACE_PROVIDER_UNAVAILABLE')
  }
  if (!response?.ok) throw new AppError(response?.status === 429 ? `${config.label} is busy. Try again shortly.` : `${config.label} could not complete this request. Check the server model and credential.`, 502, 'TRACE_PROVIDER_ERROR')
  if (onText && response.headers.get('content-type')?.includes('text/event-stream')) return readProviderStream(response, signal, onText, tolerateLength)
  let body
  try { body = await response.json() } catch { /* sanitized error below */ }
  const finishReason = body?.choices?.[0]?.finish_reason || null
  if (isContentFilter(body?.error) || finishReason === 'content_filter') throw filteredResponse()
  if (finishReason === 'length' && tolerateLength) return { message: null, finishReason, streamed: false }
  const message = body?.choices?.[0]?.message
  if (!message || (typeof message.content !== 'string' && !Array.isArray(message.tool_calls))) throw new AppError('The AI provider returned an unsupported response.', 502, 'TRACE_PROVIDER_ERROR')
  return { message, finishReason, streamed: false }
}
const lengthError = () => new AppError('The AI provider could not return a complete answer. Please ask a narrower question.', 502, 'TRACE_PROVIDER_ERROR')
async function readProviderStream(response, signal, onText, tolerateLength = false) {
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', content = '', bytes = 0, finished = false, finishReason = null, lastIndex = 0
  const calls = new Map(), indexById = new Map()
  // Returns true for the [DONE] sentinel.
  function handleBlock(block) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data) return false
    if (data === '[DONE]') return true
    let item
    try { item = JSON.parse(data) } catch { throw new AppError('The AI provider returned an invalid stream.', 502, 'TRACE_PROVIDER_ERROR') }
    if (isContentFilter(item.error)) throw filteredResponse()
    if (item.error) throw new AppError('The AI provider could not finish this response.', 502, 'TRACE_PROVIDER_ERROR')
    const choice = item.choices?.[0], delta = choice?.delta
    if (choice?.finish_reason === 'content_filter') throw filteredResponse()
    if (choice?.finish_reason === 'length' && !tolerateLength) throw lengthError()
    if (choice?.finish_reason) finishReason = choice.finish_reason
    if (typeof delta?.content === 'string') { content += delta.content; onText(delta.content) }
    for (const part of delta?.tool_calls || []) {
      // Some OpenAI-compatible streams omit index; fall back to the call id, then the last call.
      let index = Number.isInteger(part.index) ? part.index : part.id ? (indexById.get(part.id) ?? calls.size) : lastIndex
      if (index < 0 || index > 15) throw new AppError('Invalid AI tool stream.', 502, 'TRACE_PROVIDER_ERROR')
      lastIndex = index
      const call = calls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } }
      if (part.id) { call.id = part.id; indexById.set(part.id, index) }
      if (part.type) call.type = part.type
      // Names arrive whole; providers that repeat them per chunk must not produce "xx".
      if (part.function?.name && call.function.name !== part.function.name) call.function.name += part.function.name
      const piece = part.function?.arguments
      call.function.arguments += typeof piece === 'string' ? piece : piece && typeof piece === 'object' ? JSON.stringify(piece) : ''
      calls.set(index, call)
    }
    return false
  }
  try {
    while (!finished) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 256000) throw new AppError('AI response exceeded TRACE limits.', 502, 'TRACE_PROVIDER_ERROR')
      buffer += decoder.decode(value, { stream: true })
      let boundary
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length)
        if (handleBlock(block)) { finished = true; break }
      }
    }
    // A final event the provider closed without its blank-line terminator is still a complete event.
    if (!finished) {
      buffer += decoder.decode()
      const tail = buffer.trim(); buffer = ''
      // An unparseable tail is a cut-off event: treat it as an interruption unless a finish reason
      // already arrived. Content-filter and provider errors in the tail still surface.
      try { if (tail && handleBlock(tail)) finished = true } catch (error) { if (error?.message !== 'The AI provider returned an invalid stream.' || !finishReason) throw error }
    }
    // Accept a stream that reported a finish reason but closed without the optional [DONE] sentinel.
    if (!finished && !finishReason) throw new AppError('AI response was interrupted. Retry the question.', 502, 'TRACE_PROVIDER_ERROR')
    if (finishReason === 'length') return { message: null, finishReason, streamed: true }
    return { message: { role: 'assistant', content: content || null, ...(calls.size ? { tool_calls: [...calls.values()] } : {}) }, finishReason, streamed: true }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
export { getTraceProviderConfig, getTraceProviderName, getTraceLimits, traceCompletion }
