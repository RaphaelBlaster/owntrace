import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readTraceEvents } from '../src/features/trace/trace-stream.js'

test('reads UTF-8 event data across arbitrary network chunks', async () => {
  const text = 'event: delta\r\ndata: {"text":"₹ café"}\r\n\r\nevent: complete\ndata: {"conversation":{"id":"owned"}}\n\n'
  const bytes = new TextEncoder().encode(text)
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close() } })
  const seen = []
  const result = await readTraceEvents(stream, (event, data) => seen.push({ event, data }))
  assert.equal(seen[0].data.text, '₹ café')
  assert.equal(result.conversation.id, 'owned')
})
test('does not mistake a truncated stream or error for a completed response', async () => {
  const incomplete = new Response('event: delta\ndata: {"text":"partial"}\n\n')
  await assert.rejects(readTraceEvents(incomplete.body, () => {}), /interrupted/)
  const failed = new Response('event: error\ndata: {"code":"TRACE_PROVIDER_ERROR","message":"Azure unavailable"}\n\n')
  await assert.rejects(readTraceEvents(failed.body, () => {}), /Azure unavailable/)
})
