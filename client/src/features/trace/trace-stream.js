function streamError(data) {
  const error = new Error(data.message || 'TRACE response was interrupted. Retry your question.')
  error.response = { data }; error.code = data.code
  return error
}
async function readTraceEvents(stream, onEvent) {
  if (!stream) throw streamError({ message: 'TRACE returned no response stream.' })
  const reader = stream.getReader(), decoder = new TextDecoder()
  let buffer = '', complete
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > 8000000) throw streamError({ message: 'TRACE response exceeded its limit.' })
      let boundary
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length)
        const lines = block.split(/\r?\n/)
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim()
        const raw = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (!event || !raw) continue
        let data
        try { data = JSON.parse(raw) } catch { throw streamError({ message: 'TRACE returned an invalid response stream.' }) }
        if (event === 'error') throw streamError(data)
        onEvent(event, data)
        if (event === 'complete') complete = data
      }
    }
    if (!complete) throw streamError({ message: 'TRACE response was interrupted. Your question is saved; retry it.' })
    return complete
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
async function sendTraceMessage(baseURL, conversationId, body, signal, onEvent) {
  const response = await fetch(`${baseURL.replace(/\/$/, '')}/trace/conversations/${conversationId}/messages`, { method: 'POST', credentials: 'include', signal, headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body) })
  if (!response.ok) {
    let data
    try { data = await response.json() } catch { data = { message: 'TRACE could not receive your question.' } }
    throw streamError(data)
  }
  return readTraceEvents(response.body, onEvent)
}
export { readTraceEvents, sendTraceMessage }
