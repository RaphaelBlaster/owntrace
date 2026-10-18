import request from 'supertest'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import app from '../src/app.js'
import User from '../src/models/user.model.js'
import {decideTraceScope} from '../src/services/trace-scope.service.js'
beforeEach(()=>{vi.stubEnv('TRACE_PROVIDER','inception');vi.stubEnv('TRACE_DECISION_PROVIDER','typesafe');vi.stubEnv('TYPESAFE_API_KEY','jev-test');vi.stubEnv('INCEPTION_API_KEY','chat-test')})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
const answer=()=>({model:'jev-1.13.0',usage:{input_tokens:10,output_tokens:10},answers:{scope:{type:'choice',choice:'allowed',confidence:1,probabilities:{allowed:1,clarify:0,out_of_domain:0}},effect:{type:'choice',choice:'read_only',confidence:1,probabilities:{read_only:1,confirmation_required:0}},needs_records:{type:'noul',noul:0},record_family:{type:'choice',choice:'none',confidence:1,probabilities:{orders:0,accounts:0,subscriptions:0,actions:0,health:0,security:0,status:0,none:1}}}})
it('uses one Jev request for structured decisions and sends no chat key',async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify(answer())));vi.stubGlobal('fetch',fetch)
 const result=await decideTraceScope([],'hi',new AbortController().signal,{provider:'inception',key:'chat-test'})
 expect(result).toMatchObject({scope:'allowed',requiresRecords:false,decisionProvider:'typesafe'})
 expect(fetch).toHaveBeenCalledTimes(1)
 expect(String(fetch.mock.calls[0][0])).toBe('https://api.typesafe.ai/v1/systemone')
 expect(JSON.stringify(fetch.mock.calls[0])).not.toContain('chat-test')
})
it('fails closed on an invalid Jev decision and never falls back to another provider',async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({model:'jev',answers:{}})));vi.stubGlobal('fetch',fetch)
 await expect(decideTraceScope([],'hi',new AbortController().signal,{provider:'inception',key:'chat-test'})).rejects.toMatchObject({code:'TRACE_SCOPE_INVALID'})
 expect(fetch).toHaveBeenCalledTimes(1)
})
it('clarifies uncertain Jev retrieval probabilities',async()=>{
 const result=answer();result.answers.needs_records.noul=.5
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(result))))
 await expect(decideTraceScope([],'those',new AbortController().signal,{provider:'inception',key:'chat-test'})).resolves.toMatchObject({scope:'clarify'})
})
it('requires a Jev key and never silently falls back',async()=>{
 vi.stubEnv('TYPESAFE_API_KEY','')
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 await expect(decideTraceScope([],'hi',new AbortController().signal,{provider:'inception',key:'chat-test'})).rejects.toMatchObject({code:'TRACE_NOT_CONFIGURED'})
 expect(fetch).not.toHaveBeenCalled()
})
it('stops the Jev call when the user cancels',async()=>{
 const controller=new AbortController()
 vi.stubGlobal('fetch',vi.fn((_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}))))
 const pending=decideTraceScope([],'hi',controller.signal,{provider:'inception',key:'chat-test'})
 controller.abort()
 await expect(pending).rejects.toMatchObject({name:'AbortError'})
})
it('requires renewed consent before disclosing questions to TypeSafe',async()=>{
 const agent=request.agent(app)
 const registered=await agent.post('/api/auth/register').send({name:'Jev tester',email:'jev-consent@example.com',password:'a secure test password'}).expect(201)
 await User.updateOne({_id:registered.body.user.id},{onboardingStatus:'COMPLETED',traceAiConsent:{provider:'inception',version:1,acceptedAt:new Date()}})
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 const status=await agent.get('/api/trace/status').expect(200)
 expect(status.body).toMatchObject({decisionProvider:'typesafe',consentEnabled:false})
 const chat=await agent.post('/api/trace/conversations').send({}).expect(201)
 await agent.post(`/api/trace/conversations/${chat.body.conversation.id}/messages`).send({content:'hi'}).expect(403)
 expect(fetch).not.toHaveBeenCalled()
 await agent.put('/api/trace/consent').send({enabled:true}).expect(200)
 expect((await User.findById(registered.body.user.id)).traceAiConsent.version).toBe(2)
 expect((await agent.get('/api/trace/status')).body.consentEnabled).toBe(true)
})
