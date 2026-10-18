import AppError from '../utils/app-error.js'
import { setTimeout as delay } from 'node:timers/promises'
import { logEvent } from '../utils/logger.js'

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
  let response
  try {
    response = await requestCompletion(config.url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...(config.provider === 'azure' ? { 'api-key': config.key } : {}), Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ model: config.model, messages, ...(tools?.length ? { tools, tool_choice: options.toolChoice || 'auto', parallel_tool_calls: false } : {}), max_completion_tokens: options.maxTokens || 1800, ...(config.provider === 'inception' ? { diffusing: false } : {}), ...(onText ? { stream: true } : {}) }),
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new AppError(`TRACE could not reach ${config.label}. Try again shortly.`, 502, 'TRACE_PROVIDER_UNAVAILABLE')
  }
  if (!response?.ok) throw new AppError(response?.status === 429 ? `${config.label} is busy. Try again shortly.` : `${config.label} could not complete this request. Check the server model and credential.`, 502, 'TRACE_PROVIDER_ERROR')
  if (onText && response.headers.get('content-type')?.includes('text/event-stream')) return readProviderStream(response, signal, onText)
  let message
  try { message = (await response.json()).choices?.[0]?.message } catch { /* sanitized error below */ }
  if (!message || (typeof message.content !== 'string' && !Array.isArray(message.tool_calls))) throw new AppError('The AI provider returned an unsupported response.', 502, 'TRACE_PROVIDER_ERROR')
  if (onText && message.content) onText(message.content)
  return message
}
async function readProviderStream(response, signal, onText) {
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', content = '', bytes = 0, finished = false
  const calls = new Map()
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
        const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (!data) continue
        if (data === '[DONE]') { finished = true; break }
        let item
        try { item = JSON.parse(data) } catch { throw new AppError('The AI provider returned an invalid stream.', 502, 'TRACE_PROVIDER_ERROR') }
        if (item.error) throw new AppError('The AI provider could not finish this response.', 502, 'TRACE_PROVIDER_ERROR')
        const choice = item.choices?.[0], delta = choice?.delta
        if (choice?.finish_reason === 'length' || choice?.finish_reason === 'content_filter') throw new AppError('The AI provider could not return a complete answer. Please ask a narrower question.', 502, 'TRACE_PROVIDER_ERROR')
        if (typeof delta?.content === 'string') { content += delta.content; onText(delta.content) }
        for (const part of delta?.tool_calls || []) {
          if (!Number.isInteger(part.index) || part.index < 0 || part.index > 5) throw new AppError('Invalid AI tool stream.', 502, 'TRACE_PROVIDER_ERROR')
          const call = calls.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } }
          if (part.id) call.id = part.id
          if (part.type) call.type = part.type
          call.function.name += part.function?.name || ''; call.function.arguments += part.function?.arguments || ''
          calls.set(part.index, call)
        }
      }
    }
    if (!finished) throw new AppError('AI response was interrupted. Retry the question.', 502, 'TRACE_PROVIDER_ERROR')
    return { role: 'assistant', content: content || null, ...(calls.size ? { tool_calls: [...calls.values()] } : {}) }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
export { getTraceProviderConfig, getTraceProviderName, traceCompletion }
