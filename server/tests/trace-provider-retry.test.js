import { afterEach, expect, it, vi } from 'vitest'
import { traceCompletion } from '../src/services/trace-provider.service.js'
afterEach(()=>vi.unstubAllGlobals())
const config={provider:'inception',url:'https://api.inceptionlabs.ai/v1/chat/completions',key:'test',model:'mercury-2',label:'Inception Labs'}
it('retries a rejected request before delivering any text',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response('{}',{status:429})).mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:'Hello'}}]})))
  vi.stubGlobal('fetch',fetch)
  const onText=vi.fn()
  await expect(traceCompletion([],[],new AbortController().signal,onText,config)).resolves.toMatchObject({content:'Hello'})
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(onText).toHaveBeenCalledExactlyOnceWith('Hello')
})
it('does not retry authentication errors or replay an interrupted stream',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response('{}',{status:401}))
  vi.stubGlobal('fetch',fetch)
  await expect(traceCompletion([],[],new AbortController().signal,undefined,config)).rejects.toMatchObject({code:'TRACE_PROVIDER_ERROR'})
  expect(fetch).toHaveBeenCalledTimes(1)
  fetch.mockReset().mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',{headers:{'Content-Type':'text/event-stream'}}))
  await expect(traceCompletion([],[],new AbortController().signal,vi.fn(),config)).rejects.toMatchObject({code:'TRACE_PROVIDER_ERROR'})
  expect(fetch).toHaveBeenCalledTimes(1)
})
