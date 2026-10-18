import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import User from '../src/models/user.model.js'
import Account from '../src/models/account.model.js'
import Conversation from '../src/models/trace-conversation.model.js'
import { executeTraceTool } from '../src/services/trace-tools.service.js'
import { decideTraceScope, traceReferenceContext } from '../src/services/trace-scope.service.js'

beforeEach(()=>{vi.stubEnv('TRACE_PROVIDER','inception');vi.stubEnv('INCEPTION_API_KEY','test-scope-key')})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks()})
const decision=(scope='allowed',effect='read_only',families=[])=>({answers:{scope:{type:'choice',choice:scope,confidence:1,probabilities:Object.fromEntries(['allowed','clarify','out_of_domain'].map(key=>[key,key===scope?1:0]))},effect:{type:'choice',choice:effect,confidence:1,probabilities:Object.fromEntries(['read_only','confirmation_required'].map(key=>[key,key===effect?1:0]))},needs_records:{type:'noul',noul:families.length?1:0},record_family:{type:'choice',choice:families[0]||'none',probabilities:Object.fromEntries(['accounts','subscriptions','actions','health','security','status','orders','none'].map(key=>[key,key===(families[0]||'none')?1:0]))}}})
async function session(email,consent=true){const agent=request.agent(app);const registered=await agent.post('/api/auth/register').send({name:'Scope tester',email,password:'a secure test password'}).expect(201);await User.updateOne({_id:registered.body.user.id},{onboardingStatus:'COMPLETED'});if(consent)await agent.put('/api/trace/consent').send({enabled:true}).expect(200);const created=await agent.post('/api/trace/conversations').send({}).expect(201);return {agent,id:registered.body.user.id,conversation:created.body.conversation.id,path:`/api/trace/conversations/${created.body.conversation.id}/messages`}}
describe('TRACE semantic scope and tool boundary',()=>{
  it('bounds navigation context and excludes prose, IDs, failed actions and unknown metadata',()=>{
    const history=[{role:'assistant',status:'failed',actions:[{type:'show_subscriptions'}]},...Array.from({length:8},()=>({role:'assistant',status:'completed',content:'PRIVATE RECORD DATA',actions:[{type:'focus_entity',entityType:'subscription',entityId:'PRIVATE-ID'},{type:'navigate_to_page',page:'UNTRUSTED'},{type:'arbitrary',page:'settings'}],grounding:[{tool:'scope_decision',query:{scope:'allowed',requiredRecords:['subscriptions','UNTRUSTED']}}]}))]
    const context=traceReferenceContext(history)
    expect(context.recentWorkspaceContext).toHaveLength(3)
    expect(context.recentWorkspaceContext.every(item=>JSON.stringify(item)===JSON.stringify({recordFamilies:['subscriptions'],views:['subscription']}))).toBe(true)
    expect(JSON.stringify(context)).not.toMatch(/PRIVATE|UNTRUSTED|settings/)
  })
  it.each(['out_of_domain','clarify'])('does not retrieve private data or generate outside the %s boundary',async scope=>{
    const {agent,path}=await session(`scope-${scope}@example.com`)
    const lookup=vi.spyOn(Account,'find')
    const fetch=vi.fn(async()=>new Response(JSON.stringify(decision(scope))));vi.stubGlobal('fetch',fetch)
    const response=await agent.post(path).send({content:'Unrelated or ambiguous request'}).expect(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('https://api.inceptionlabs.ai/v1/decisions')
    expect(lookup).not.toHaveBeenCalled()
    const answer=response.body.conversation.messages.at(-1)
    expect(answer.actions).toEqual([]);expect(answer.sources).toEqual([])
    expect(answer.grounding[0].query.scope).toBe(scope)
  })
  it.each([503,429,'malformed'])('fails before any private retrieval on classifier %s',async failure=>{
    const {agent,path,conversation}=await session(`scope-failure-${failure}@example.com`)
    const lookup=vi.spyOn(Account,'find')
    const fetch=vi.fn(async()=>failure==='malformed'?new Response('{}'):new Response('{}',{status:failure}));vi.stubGlobal('fetch',fetch)
    await agent.post(path).send({content:'Show my accounts'}).expect(502)
    expect(fetch).toHaveBeenCalledTimes(failure==='malformed'?1:2);expect(lookup).not.toHaveBeenCalled()
    const saved=await Conversation.findById(conversation).select('+leaseId')
    expect(saved.messages[0].status).toBe('failed');expect(saved.leaseId).toBe(null)
  })
  it('retries one transient decision failure without bypassing the real scope decision',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(new Response('{}',{status:503})).mockResolvedValueOnce(new Response(JSON.stringify(decision())))
    vi.stubGlobal('fetch',fetch)
    const result=await decideTraceScope([],'hello',new AbortController().signal,{provider:'inception',key:'test'})
    expect(result).toMatchObject({scope:'allowed',requiresRecords:false})
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.every(([,options])=>!JSON.stringify(options.body).includes('PRIVATE RECORD'))).toBe(true)
  })
  it('retries a network failure but never retries authentication failure',async()=>{
    const fetch=vi.fn().mockRejectedValueOnce(new TypeError('network failure')).mockResolvedValueOnce(new Response(JSON.stringify(decision())))
    vi.stubGlobal('fetch',fetch)
    await expect(decideTraceScope([],'hello',new AbortController().signal,{provider:'inception',key:'test'})).resolves.toMatchObject({scope:'allowed'})
    expect(fetch).toHaveBeenCalledTimes(2)
    fetch.mockReset().mockResolvedValue(new Response('{}',{status:401}))
    await expect(decideTraceScope([],'hello',new AbortController().signal,{provider:'inception',key:'test'})).rejects.toMatchObject({code:'TRACE_SCOPE_UNAVAILABLE'})
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not issue a retry after Stop cancels a failed scope attempt',async()=>{
    const controller=new AbortController()
    const fetch=vi.fn(async()=>{controller.abort();return new Response('{}',{status:503})})
    vi.stubGlobal('fetch',fetch)
    await expect(decideTraceScope([],'hello',controller.signal,{provider:'inception',key:'test'})).rejects.toMatchObject({name:'AbortError'})
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('reports provider throttling clearly and respects a long Retry-After without retrying early',async()=>{
    const fetch=vi.fn(async()=>new Response('{}',{status:429,headers:{'Retry-After':'60'}}))
    vi.stubGlobal('fetch',fetch)
    await expect(decideTraceScope([],'hello',new AbortController().signal,{provider:'inception',key:'test'})).rejects.toMatchObject({code:'TRACE_SCOPE_UNAVAILABLE',message:expect.stringContaining('rate-limiting')})
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('sends only bounded user-question context, no retrieved records; uncertainty clarifies',async()=>{
    let payload
    vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{payload=JSON.parse(options.body);const result=decision();result.answers.scope.confidence=.4;result.answers.scope.probabilities={allowed:.55,clarify:.4,out_of_domain:.05};return new Response(JSON.stringify(result))}))
    const history=[{role:'assistant',status:'completed',content:'PRIVATE RECORD DATA',actions:[{type:'show_subscriptions'}],grounding:[{tool:'scope_decision',query:{scope:'allowed',requiredRecords:['subscriptions']}}]},{role:'user',status:'completed',content:'Show my subscriptions'}]
    const result=await decideTraceScope(history,'What about the next page?',new AbortController().signal,{provider:'inception',key:'test'})
    expect(payload.state.recentUserMessages).toEqual(['Show my subscriptions'])
    expect(payload.state.recentWorkspaceContext).toEqual([{recordFamilies:['subscriptions'],views:['subscriptions']}])
    expect(JSON.stringify(payload)).not.toContain('PRIVATE RECORD DATA')
    expect(result.scope).toBe('clarify')
  })
  it('retains panel context for close followups without fetching private records',async()=>{
    const {agent,path,conversation}=await session('scope-close-context@example.com')
    await Conversation.updateOne({_id:conversation},{$push:{messages:{$each:[
      {role:'user',status:'completed',content:'Show my subscriptions'},
      {role:'assistant',status:'completed',content:'PRIVATE RECORD DATA',actions:[{type:'show_subscriptions'}],grounding:[{tool:'scope_decision',query:{scope:'allowed',requiredRecords:['subscriptions']}}]},
    ]}}})
    const lookup=vi.spyOn(Account,'find'),payloads=[]
    let round=0
    vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
      const body=JSON.parse(options.body);payloads.push(body)
      if(String(url).endsWith('/decisions'))return new Response(JSON.stringify(decision()))
      const message=++round===1?{tool_calls:[{id:'close',type:'function',function:{name:'close_preview',arguments:'{}'}}]}:{content:'Closed the workspace panel.'}
      return new Response(JSON.stringify({choices:[{message}]}))
    }))
    const result=await agent.post(path).send({content:'okay pls close it'}).expect(200)
    expect(result.body.conversation.messages.at(-1).actions).toEqual([{type:'close_preview'}])
    expect(payloads[0].state.recentWorkspaceContext).toEqual([{recordFamilies:['subscriptions'],views:['subscriptions']}])
    expect(JSON.stringify(payloads[1].messages[0])).toContain('recentWorkspaceContext')
    expect(JSON.stringify(payloads)).not.toContain('PRIVATE RECORD DATA')
    expect(lookup).not.toHaveBeenCalled()
  })
  it('allows explanations without fetching workspace data',async()=>{
    const {agent,path}=await session('scope-explanation@example.com')
    const lookup=vi.spyOn(Account,'find'), calls=[]
    vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
      const body=JSON.parse(options.body);calls.push(body)
      if(String(url).endsWith('/decisions'))return new Response(JSON.stringify(decision()))
      const message=body.tools?.length ? {tool_calls:[{id:'finish',type:'function',function:{name:'finish_answer',arguments:JSON.stringify({presentation:'chat',view:'none',entityId:''})}}]} : {content:'Privacy Health explains current OwnTrace account and recommendation signals.'}
      return new Response(JSON.stringify({choices:[{message}]}))
    }))
    await agent.post(path).send({content:'What does OwnTrace Privacy Health mean?'}).expect(200)
    expect(lookup).not.toHaveBeenCalled();expect(calls).toHaveLength(3)
    expect(calls[1].messages.some(message=>message.role==='tool')).toBe(false)
  })
  it('retrieves only after a model-selected tool and retains explicit confirmation boundaries',async()=>{
    const {agent,path}=await session('scope-dynamic@example.com')
    await Account.create({userId:(await User.findOne({email:'scope-dynamic@example.com'})).id,serviceKey:'private.example',serviceName:'Private service',primaryDomain:'private.example',confidenceScore:80,confidenceLevel:'LIKELY',evidenceCount:1,ownershipEvidenceCount:1,firstSeenAt:new Date(),lastSeenAt:new Date(),lastEvaluatedAt:new Date()})
    const lookup=vi.spyOn(Account,'find'), payloads=[]
    let turn=0
    vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
      const body=JSON.parse(options.body);payloads.push(body)
      if(String(url).endsWith('/decisions'))return new Response(JSON.stringify(decision('allowed','confirmation_required',['accounts'])))
      turn++
      const message=turn===1 ? {tool_calls:[{id:'lookup',type:'function',function:{name:'query_accounts',arguments:JSON.stringify({search:'',page:1})}}]} : {content:'Review this account through the real UI and explicitly confirm any change there.'}
      return new Response(JSON.stringify({choices:[{message}]}))
    }))
    const response=await agent.post(path).send({content:'Review my accounts before deleting anything'}).expect(200)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(payloads[0])).not.toContain('Private service')
    expect(JSON.stringify(payloads[1])).not.toContain('Private service')
    expect(JSON.stringify(payloads.at(-1))).toContain('Private service')
    expect(payloads[1].tools.some(tool=>/delete|create|update/.test(tool.function.name))).toBe(false)
    expect(response.body.conversation.messages.at(-1).grounding[0].query.effect).toBe('confirmation_required')
    await expect(executeTraceTool((await User.findOne({email:'scope-dynamic@example.com'})).id,'delete_account',{})).rejects.toMatchObject({code:'INVALID_TRACE_TOOL'})
  })
  it('does not classify after consent withdrawal or switch provider without new consent',async()=>{
    const {agent,path}=await session('scope-consent@example.com')
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
    await agent.put('/api/trace/consent').send({enabled:false}).expect(200)
    await agent.post(path).send({content:'Show accounts'}).expect(403)
    expect(fetch).not.toHaveBeenCalled()
    await agent.put('/api/trace/consent').send({enabled:true}).expect(200)
    vi.stubEnv('TRACE_PROVIDER','azure');vi.stubEnv('AZURE_OPENAI_ENDPOINT','https://test.openai.azure.com');vi.stubEnv('AZURE_OPENAI_API_KEY','test');vi.stubEnv('AZURE_OPENAI_DEPLOYMENT','test')
    await agent.post(path).send({content:'Show accounts'}).expect(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('blocks even a model-requested lookup on greetings',async()=>{
    const {agent,path}=await session('scope-greeting@example.com')
    const lookup=vi.spyOn(Account,'find'),payloads=[]
    let turn=0
    vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
      const body=JSON.parse(options.body);payloads.push(body)
      if(String(url).endsWith('/decisions'))return new Response(JSON.stringify(decision()))
      const message=++turn===1 ? {tool_calls:[{id:'unneeded',type:'function',function:{name:'query_accounts',arguments:'{"search":"","page":1}'}}]} : {content:'Hi! How can I help with OwnTrace?'}
      return new Response(JSON.stringify({choices:[{message}]}))
    }))
    const response=await agent.post(path).send({content:'hi how are you doing?'}).expect(200)
    expect(lookup).not.toHaveBeenCalled()
    expect(payloads[1].tools.map(tool=>tool.function.name)).toEqual(['finish_answer','calculate','navigate_to_page','close_preview'])
    expect(response.body.conversation.messages.at(-1).grounding.map(item=>item.tool)).toEqual(['scope_decision'])
  })
  it.each(['no_lookup','unrelated_lookup'])('cannot finalize personal claims after %s',async mode=>{
    const {agent,path}=await session(`scope-required-${mode}@example.com`)
    const lookup=vi.spyOn(Account,'find'),payloads=[]
    vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
      const body=JSON.parse(options.body);payloads.push(body)
      if(String(url).endsWith('/decisions'))return new Response(JSON.stringify(decision('allowed','read_only',['subscriptions'])))
      const message=mode==='unrelated_lookup' && !body.messages.some(item=>item.role==='tool') ? {tool_calls:[{id:'wrong',type:'function',function:{name:'workspace_status',arguments:'{}'}}]} : {content:'You have 999 subscriptions.'}
      return new Response(JSON.stringify({choices:[{message}]}))
    }))
    await agent.post(path).send({content:'How many subscriptions do I have?'}).expect(422)
    expect(lookup).not.toHaveBeenCalled()
    expect(payloads.filter(body=>body.messages && !body.tools?.length)).toHaveLength(0)
  })
  it('accepts a successful empty relevant query as evidence',async()=>{
    const {agent,path}=await session('scope-empty@example.com')
    let turn=0
    vi.stubGlobal('fetch',vi.fn(async(url)=>{
      if(String(url).endsWith('/decisions'))return new Response(JSON.stringify(decision('allowed','read_only',['accounts'])))
      const message=++turn===1 ? {tool_calls:[{id:'empty',type:'function',function:{name:'query_accounts',arguments:'{"search":"","page":1}'}}]} : {content:'No discovered accounts match this query.'}
      return new Response(JSON.stringify({choices:[{message}]}))
    }))
    const response=await agent.post(path).send({content:'Which accounts have you found?'}).expect(200)
    expect(response.body.conversation.messages.at(-1).grounding.map(item=>item.tool)).toContain('query_accounts')
  })
  it('blocks personal generation after a failed relevant lookup',async()=>{
    const {agent,path}=await session('scope-lookup-failed@example.com')
    vi.spyOn(Account,'find').mockImplementation(()=>{throw new Error('Database unavailable')})
    const fetch=vi.fn(async(url)=>{
      if(String(url).endsWith('/decisions'))return new Response(JSON.stringify(decision('allowed','read_only',['accounts'])))
      return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'fail',type:'function',function:{name:'query_accounts',arguments:'{"search":"","page":1}'}}]}}]}))
    });vi.stubGlobal('fetch',fetch)
    await agent.post(path).send({content:'Which accounts have you found?'}).expect(502)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('stops a scope check on cancellation before generation or data retrieval',async()=>{
    const controller=new AbortController(), lookup=vi.spyOn(Account,'find')
    vi.stubGlobal('fetch',vi.fn((_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}))))
    const pending=decideTraceScope([],'Show my accounts',controller.signal,{provider:'inception',key:'test'})
    controller.abort()
    await expect(pending).rejects.toMatchObject({name:'AbortError'})
    expect(lookup).not.toHaveBeenCalled()
  })
  it('keeps calculations bounded/read-only and opens Settings without deleting',async()=>{
    const user=new User({email:'calculator@example.com'})
    expect((await executeTraceTool(user.id,'calculate',{operation:'multiply',operands:[999,14]})).data.result).toBe(13986)
    expect((await executeTraceTool(user.id,'calculate',{operation:'percentage',operands:[25,100]})).data.result).toBe(25)
    await expect(executeTraceTool(user.id,'calculate',{operation:'divide',operands:[1,0]})).rejects.toMatchObject({code:'INVALID_TRACE_TOOL'})
    await expect(executeTraceTool(user.id,'calculate',{operation:'sum',operands:['process.exit()']})).rejects.toMatchObject({code:'INVALID_TRACE_TOOL'})
    expect((await executeTraceTool(user.id,'navigate_to_page',{page:'settings'})).actions).toEqual([{type:'navigate_to_page',page:'settings'}])
    expect((await executeTraceTool(user.id,'close_preview',{})).actions).toEqual([{type:'close_preview'}])
    await expect(executeTraceTool(user.id,'close_preview',{url:'https://example.com'})).rejects.toMatchObject({code:'INVALID_TRACE_TOOL'})
  })
})
