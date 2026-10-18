import { getAccount, getAccountSummary, listAccounts } from './account.service.js'
import { getAccountActionSummary, listAccountActions } from './account-action.service.js'
import { getPrivacyHealth, listBreachInsights, listExposureInsights, listSubscriptions } from './privacy-insight.service.js'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import GmailSyncJob from '../models/gmail-sync-job.model.js'
import MicrosoftSyncJob from '../models/microsoft-sync-job.model.js'
import AppError from '../utils/app-error.js'
import { summarizeTraceResult } from './trace-grounding.js'
import { listOrderCards, orderDetails } from './order-query.service.js'

const pages = ['dashboard', 'accounts', 'subscriptions', 'orders', 'privacy-inbox', 'account-actions', 'privacy-health', 'breaches', 'exposures', 'connect', 'settings']
const text = { type: 'string', maxLength: 80 }
const id = { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }
const pageNumber = { type: 'integer', minimum: 1, maximum: 10000 }
const definitions = [
  ['finish_answer', 'Finish gathering information and choose presentation for the final answer. Requests to show/open/inspect OwnTrace information use preview; ordinary explanations use chat. For example show subscriptions uses preview/view subscriptions. For chat use view none and empty entityId. An entity view needs its retrieved stable ID.', { presentation: { type: 'string', enum: ['chat', 'preview'] }, view: { type: 'string', enum: ['none', 'account', 'subscription', ...pages] }, entityId: { type: 'string', maxLength: 24 } }],
  ['query_accounts', 'Find only this user’s discovered accounts by service/domain. Return exact inventory totals and paginated matches. Clarify ambiguous matches.', { search: text, page: pageNumber }],
  ['get_account', 'Get an owned account and supporting metadata evidence. Use an ID returned by query_accounts.', { accountId: id }],
  ['query_subscriptions', 'Read merged Gmail/Microsoft subscription signals. Amounts may be unknown; estimates do not prove active billing.', { page: pageNumber }],
  ['query_orders', 'Read this user’s saved order email events and exact pagination. Events are evidence inferences, not unique purchase counts or live carrier tracking. Never start a scan.', { page: pageNumber }],
  ['get_order', 'Read an owned order event and timeline grouped by explicit reference and sender domain.', { orderId: id }],
  ['open_order', 'Open the real evidence timeline for an owned order event, when asked to show it.', { orderId: id }],
  ['privacy_overview', 'Read current privacy actions, derived health estimate, or stored security findings; never initiate a scan or breach check.', { section: { type: 'string', enum: ['actions', 'health', 'security'] }, page: pageNumber }],
  ['workspace_status', 'Read current connection/scan status from stored jobs, without tokens or email bodies.', {}],
  ['calculate', 'Compute bounded arithmetic for OwnTrace reasoning: billing comparisons, totals, percentages and related calculations. Operands must come from retrieved facts or clearly hypothetical user inputs. Retrieve all needed pages before workspace totals; never combine currencies. Prefer integer minor units for monetary sums. This tool retrieves no private data and changes nothing.', {operation:{type:'string',enum:['sum','subtract','multiply','divide','percentage','average']},operands:{type:'array',minItems:1,maxItems:100,items:{type:'number',minimum:-1000000000000,maximum:1000000000000}}}],
  ['navigate_to_page', 'Show a supported live OwnTrace page, only when the user asks to see/open/show it.', { page: { type: 'string', enum: pages } }],
  ['close_preview','Close the live OwnTrace side panel when requested, keeping the conversation. Changes no records.',{}],
  ['open_account', 'Open an owned account’s real evidence page, only when the user asks to show it.', { accountId: id }],
  ['show_subscriptions', 'Retrieve subscription signals and open the live subscriptions page when requested.', {}],
  ['focus_entity', 'Show and highlight a specific owned account or subscription returned by retrieval; resolve its actual page on server.', { entityType: { type: 'string', enum: ['account', 'subscription'] }, entityId: id }],
]
const traceTools = definitions.map(([name, description, properties]) => ({ type: 'function', function: { name, description, strict: true, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } } }))

// Server-owned coverage describes actual reads, including reads nested in presentation tools.
function traceToolCoverage(name,args={}) {
  if(['query_orders','get_order','open_order'].includes(name))return ['orders']
  if(['query_accounts','get_account','open_account'].includes(name))return ['accounts']
  if(['query_subscriptions','show_subscriptions'].includes(name))return ['subscriptions']
  if(name==='focus_entity')return [args.entityType==='account'?'accounts':'subscriptions']
  if(name==='workspace_status')return ['status']
  if(name==='privacy_overview')return [args.section]
  if(name==='finish_answer' && args.presentation==='preview') {
    if(args.view==='account')return ['accounts']
    if(['subscription','subscriptions'].includes(args.view))return ['subscriptions']
  }
  return []
}

function validateTool(name, args) {
  const tool = traceTools.find((item) => item.function.name === name)
  if (!tool || !args || typeof args !== 'object' || Array.isArray(args)) throw new AppError('Unsupported TRACE tool.', 400, 'INVALID_TRACE_TOOL')
  const fields = tool.function.parameters.properties
  if (Object.keys(args).some((key) => !Object.hasOwn(fields, key)) || Object.keys(fields).some((key) => !Object.hasOwn(args, key))) throw new AppError('Invalid TRACE tool parameters.', 400, 'INVALID_TRACE_TOOL')
  for (const [key, rule] of Object.entries(fields)) {
    const value = args[key]
    if (rule.type === 'string' && (typeof value !== 'string' || value.length > (rule.maxLength || 80) || (rule.pattern && !new RegExp(rule.pattern).test(value)) || (rule.enum && !rule.enum.includes(value)))) throw new AppError('Invalid TRACE tool parameters.', 400, 'INVALID_TRACE_TOOL')
    if (rule.type === 'integer' && (!Number.isInteger(value) || value < rule.minimum || value > rule.maximum)) throw new AppError('Invalid TRACE tool page.', 400, 'INVALID_TRACE_TOOL')
    if(rule.type==='array' && (!Array.isArray(value) || value.length<rule.minItems || value.length>rule.maxItems || value.some(number=>!Number.isFinite(number) || number<rule.items.minimum || number>rule.items.maximum)))throw new AppError('Choose bounded numeric operands.',400,'INVALID_TRACE_TOOL')
  }
}
const source = (label, action) => ({ label, action })
async function executeTraceTool(userId, name, args) {
  validateTool(name, args)
  const sources = [], actions = []
  let data
  const query = { page: String(args.page || 1), limit: '12' }
  if (name === 'finish_answer') {
    data = { ready: true }
    if (args.presentation === 'chat' && (args.view !== 'none' || args.entityId)) throw new AppError('Choose a consistent answer presentation.', 400, 'INVALID_TRACE_TOOL')
    if (args.presentation === 'preview') {
      let result
      if (args.view === 'account') result = await executeTraceTool(userId, 'open_account', { accountId: args.entityId })
      else if (args.view === 'subscription') result = await executeTraceTool(userId, 'focus_entity', { entityType: 'subscription', entityId: args.entityId })
      else if (args.view === 'subscriptions' && !args.entityId) result = await executeTraceTool(userId, 'show_subscriptions', {})
      else if (pages.includes(args.view) && !args.entityId) result = await executeTraceTool(userId, 'navigate_to_page', { page: args.view })
      else throw new AppError('Choose a supported preview.', 400, 'INVALID_TRACE_TOOL')
      actions.push(...result.actions); sources.push(...result.sources)
      data.preview = result.data
    }
  } else if(name==='close_preview') {
    data={closed:true};actions.push({type:'close_preview'})
  } else if(name==='calculate') {
    const values=args.operands
    if(['divide','percentage'].includes(args.operation) && (values.length!==2 || values[1]===0))throw new AppError('This calculation needs two operands and a nonzero divisor.',400,'INVALID_TRACE_TOOL')
    let result
    if(args.operation==='sum')result=values.reduce((total,value)=>total+value,0)
    if(args.operation==='subtract')result=values.slice(1).reduce((total,value)=>total-value,values[0])
    if(args.operation==='multiply')result=values.reduce((total,value)=>total*value,1)
    if(args.operation==='divide')result=values[0]/values[1]
    if(args.operation==='percentage')result=values[0]/values[1]*100
    if(args.operation==='average')result=values.reduce((total,value)=>total+value,0)/values.length
    if(!Number.isFinite(result) || Math.abs(result)>1e15)throw new AppError('This calculation exceeds supported precision limits.',400,'INVALID_TRACE_TOOL')
    data={...args,result:Number(result.toPrecision(14)),precision:'14 significant digits; keep the same operand units'}
  } else if (name === 'query_accounts') {
    data = { ...await listAccounts(userId, { ...query, search: args.search }), summary: await getAccountSummary(userId) }
    sources.push(...data.accounts.map((account) => source(`${account.serviceName} · account evidence`, { type: 'open_account', accountId: account.id })))
    sources.push(source('Account inventory', { type: 'navigate_to_page', page: 'accounts' }))
  } else if (['get_account', 'open_account'].includes(name) || (name === 'focus_entity' && args.entityType === 'account')) {
    const accountId = args.accountId || args.entityId
    data = await getAccount(userId, accountId)
    sources.push(source(`${data.account.serviceName} · ${data.evidenceTotal} evidence signals`, { type: 'open_account', accountId }))
    if (name !== 'get_account') actions.push({ type: 'open_account', accountId })
  } else if (name === 'query_orders') {
    data = await listOrderCards(userId, { page: args.page, limit: 12 })
    sources.push(source('Order email events', { type: 'navigate_to_page', page: 'orders' }))
    sources.push(...data.orders.map(item => source(item.merchant.name + ' · order evidence', { type: 'open_order', orderId: item.id })))
  } else if (['get_order','open_order'].includes(name)) {
    data = await orderDetails(userId, args.orderId)
    sources.push(source(data.order.merchant.name + ' · order evidence', { type: 'open_order', orderId: data.order.id }))
    if(name === 'open_order')actions.push({ type: 'open_order', orderId: data.order.id })
  } else if (['query_subscriptions', 'show_subscriptions'].includes(name)) {
    data = await listSubscriptions(userId, query)
    sources.push(source('Subscription signals', { type: 'show_subscriptions' }))
    sources.push(...data.subscriptions.map((item) => source(`${item.serviceName} · subscription evidence`, { type: 'focus_entity', entityType: 'subscription', entityId: item.id })))
    if (name === 'show_subscriptions') actions.push({ type: 'show_subscriptions' })
  } else if (name === 'focus_entity') {
    data = await listSubscriptions(userId, { limit: '12', page: '1', focusId: args.entityId })
    if (!data.focusedPage) throw new AppError('Subscription no longer available.', 404, 'TRACE_ENTITY_NOT_FOUND')
    actions.push({ type: 'focus_entity', entityType: 'subscription', entityId: args.entityId, page: data.focusedPage })
    sources.push(source('Subscription signals', { type: 'show_subscriptions' }))
  } else if (name === 'privacy_overview') {
    if (args.section === 'health') data = await getPrivacyHealth(userId)
    if (args.section === 'actions') data = { ...await listAccountActions(userId, query), summary: await getAccountActionSummary(userId) }
    if (args.section === 'security') data = { breaches: await listBreachInsights(userId, query), exposures: await listExposureInsights(userId, query) }
    sources.push(source(`OwnTrace ${args.section}`, { type: 'navigate_to_page', page: { health: 'privacy-health', actions: 'privacy-inbox', security: 'breaches' }[args.section] }))
  } else if (name === 'workspace_status') {
    const connectionFields = 'status connectedAt lastSyncAt lastErrorCode -_id'
    const jobFields = 'status processedCount storedCount estimatedTotal startedAt completedAt lastErrorCode -_id'
    const [google, microsoft, gmailScan, microsoftScan] = await Promise.all([
      GoogleConnection.findOne({ userId }).select(connectionFields).lean(), MicrosoftConnection.findOne({ userId }).select(connectionFields).lean(),
      GmailSyncJob.findOne({ userId }).select(jobFields).lean(), MicrosoftSyncJob.findOne({ userId }).select(jobFields).lean(),
    ])
    data = { google, microsoft, gmailScan, microsoftScan, observedAt: new Date().toISOString() }
    sources.push(source('Mail connections and scan status', { type: 'navigate_to_page', page: 'connect' }))
  } else {
    data = { page: args.page }
    actions.push({ type: 'navigate_to_page', page: args.page })
  }
  return { coverage:traceToolCoverage(name,args), resultSummary:summarizeTraceResult(data), query:args, data, sources, actions, retrievedAt: new Date().toISOString() }
}
export { executeTraceTool, traceTools, validateTool, traceToolCoverage, pages }
