import { getAccount, getAccountSummary, listAccounts } from './account.service.js'
import { getAccountActionSummary, listAccountActions } from './account-action.service.js'
import { getPrivacyHealth, listBreachInsights, listExposureInsights, listSubscriptions } from './privacy-insight.service.js'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import GmailSyncJob from '../models/gmail-sync-job.model.js'
import MicrosoftSyncJob from '../models/microsoft-sync-job.model.js'
import { MailAnalysis } from '../models/mail-insight.model.js'
import AppError from '../utils/app-error.js'
import { summarizeTraceResult } from './trace-grounding.js'
import { listOrderCards, orderDetails } from './order-query.service.js'
import { getBreachReportForUser, serializeBreachReport } from './breach-report.service.js'

const pages = ['dashboard', 'accounts', 'subscriptions', 'orders', 'top-k', 'privacy-inbox', 'account-actions', 'privacy-health', 'breaches', 'exposures', 'connect', 'settings']
const text = { type: 'string', maxLength: 80 }
const id = { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }
const pageNumber = { type: 'integer', minimum: 1, maximum: 10000 }
// Saved MailInsight statuses (mail-intelligence.service.js). A free-text status let the model guess
// values such as "rejection" or "Interview scheduled", which silently matched nothing.
const mailStatuses = ['', 'application_received', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn', 'unknown', 'received', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded', 'renewed', 'charged', 'alert', 'booked', 'updated']
const definitions = [
  ['finish_answer', 'Finish gathering information and choose presentation for the final answer. Requests to show/open/inspect OwnTrace information use preview; ordinary explanations use chat. For example show subscriptions uses preview/view subscriptions. For chat use view none and empty entityId. An entity view needs its retrieved stable ID.', { presentation: { type: 'string', enum: ['chat', 'preview'] }, view: { type: 'string', enum: ['none', 'account', 'subscription', ...pages] }, entityId: { type: 'string', maxLength: 24 } }],
  ['query_accounts', 'Find only this user’s discovered accounts by service/domain. Return exact inventory totals and paginated matches. Clarify ambiguous matches.', { search: text, page: pageNumber }],
  ['get_account', 'Get an owned account and supporting metadata evidence. Use an ID returned by query_accounts.', { accountId: id }],
  ['query_subscriptions', 'Read merged Gmail/Microsoft subscription signals. Amounts may be unknown; estimates do not prove active billing. search is a short service name or domain (for example Netflix) that narrows the list in one lookup; use an empty search to list everything.', { search: text, page: pageNumber }],
  ['query_orders', 'Read this user’s saved order email events and exact pagination. Events are evidence inferences, not unique purchase counts or live carrier tracking. search is a short merchant, domain or item keyword (for example Amazon) that narrows the list in one lookup; use an empty search to list everything. Never start a scan.', { search: text, page: pageNumber }],
  ['query_mail_insights', 'Read this user’s saved, derived mail insights. For any job question set category to jobs. Use kind applications for actual application timelines, opportunities for alerts or invitations with no evidence of an application, and all when comparing both. Empty category reads all categories. Use an empty status for every status; job statuses are application_received, assessment, interview, offer, rejected and withdrawn. search is a short company, role or keyword (for example Acme), not a sentence; use an empty search to list everything. Status distributions cover all matching saved groups before pagination. Never search mailbox contents or start a scan.', { category: { type: 'string', enum: ['', 'jobs', 'orders', 'subscriptions', 'security', 'finance', 'travel', 'social', 'marketing', 'spam', 'personal', 'other'] }, status: { type: 'string', enum: mailStatuses }, search: text, page: pageNumber, kind: { type: 'string', enum: ['applications', 'opportunities', 'all'] } }],
  ['get_order', 'Read an owned order event and timeline grouped by explicit reference and sender domain.', { orderId: id }],
  ['open_order', 'Open the real evidence timeline for an owned order event, when asked to show it.', { orderId: id }],
  ['privacy_overview', 'Read current privacy actions, derived health estimate, or security findings. section security includes the saved verified XposedOrNot breach check for the account email (use it for "was my email leaked") plus mail-derived breach/exposure signals; never initiate a scan or breach check.', { section: { type: 'string', enum: ['actions', 'health', 'security'] }, page: pageNumber }],
  ['workspace_status', 'Read current connection/scan status from stored jobs, without tokens or email bodies.', {}],
  ['calculate', 'Compute bounded arithmetic for OwnTrace reasoning: billing comparisons, totals, percentages and related calculations. Operands must come from retrieved facts or clearly hypothetical user inputs. Retrieve all needed pages before workspace totals; never combine currencies. Prefer integer minor units for monetary sums. This tool retrieves no private data and changes nothing.', {operation:{type:'string',enum:['sum','subtract','multiply','divide','percentage','average']},operands:{type:'array',minItems:1,maxItems:100,items:{type:'number',minimum:-1000000000000,maximum:1000000000000}}}],
  ['navigate_to_page', 'Show a supported live OwnTrace page, only when the user asks to see/open/show it.', { page: { type: 'string', enum: pages } }],
  ['close_preview','Close the live OwnTrace side panel when requested, keeping the conversation. Changes no records.',{}],
  ['open_account', 'Open an owned account’s real evidence page, only when the user asks to show it.', { accountId: id }],
  ['show_subscriptions', 'Retrieve subscription signals and open the live subscriptions page when requested.', {}],
  ['focus_entity', 'Show and highlight a specific owned account or subscription returned by retrieval; resolve its actual page on server.', { entityType: { type: 'string', enum: ['account', 'subscription'] }, entityId: id }],
]
const traceTools = definitions.map(([name, description, properties]) => ({ type: 'function', function: { name, description, strict: true, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } } }))
const planFamilies = ['accounts', 'subscriptions', 'orders', 'applications', 'opportunities', 'mailInsights', 'actions', 'health', 'security', 'status']
const tracePlanTool = { type: 'function', function: { name: 'plan_trace_retrieval', description: 'Identify which current private OwnTrace record families are needed to answer the latest request. Use applications for actual jobs the user applied to or their status updates; use opportunities only for alerts/invitations to apply. Use an empty array for greetings, general explanations and hypothetical questions that need no saved records. This only plans retrieval; it does not answer or read data.', strict: true, parameters: { type: 'object', properties: { requiredFamilies: { type: 'array', items: { type: 'string', enum: planFamilies } } }, required: ['requiredFamilies'], additionalProperties: false } } }
// Near-miss family names that non-strict providers send (for example "jobs" or "subs"). Keys are
// lowercase with separators removed; values must be real planFamilies entries.
const planFamilyAliases = {
  account: 'accounts', logins: 'accounts', login: 'accounts', services: 'accounts', profiles: 'accounts',
  subscription: 'subscriptions', subs: 'subscriptions', sub: 'subscriptions', billing: 'subscriptions', memberships: 'subscriptions', renewals: 'subscriptions',
  order: 'orders', purchases: 'orders', purchase: 'orders', deliveries: 'orders', delivery: 'orders', shipments: 'orders', packages: 'orders',
  application: 'applications', jobs: 'applications', job: 'applications', jobapplications: 'applications', jobapplication: 'applications', applied: 'applications',
  opportunity: 'opportunities', jobopportunities: 'opportunities', jobalerts: 'opportunities', recommendations: 'opportunities', invitations: 'opportunities',
  mailinsight: 'mailInsights', mailinsights: 'mailInsights', mail: 'mailInsights', emails: 'mailInsights', email: 'mailInsights', insights: 'mailInsights', topk: 'mailInsights',
  action: 'actions', accountactions: 'actions', privacyinbox: 'actions', recommendedactions: 'actions',
  privacyhealth: 'health', healthscore: 'health',
  breaches: 'security', breach: 'security', exposures: 'security', securityfindings: 'security',
  workspacestatus: 'status', scan: 'status', scans: 'status', scanstatus: 'status', connections: 'status', connection: 'status',
}
function normalizePlanFamily(family) {
  if (typeof family !== 'string' || family.length > 60) return family
  if (planFamilies.includes(family)) return family
  const key = family.toLowerCase().replace(/[^a-z]/g, '')
  return planFamilies.find(item => item.toLowerCase() === key) || planFamilyAliases[key] || family
}
function validateTracePlan(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 1 || !Array.isArray(args.requiredFamilies) || args.requiredFamilies.length > planFamilies.length * 2) throw new AppError('TRACE could not validate its retrieval plan.', 502, 'TRACE_PLAN_INVALID')
  const families = [...new Set(args.requiredFamilies.map(normalizePlanFamily))]
  if (families.length > planFamilies.length || families.some(family => !planFamilies.includes(family))) throw new AppError('TRACE could not validate its retrieval plan.', 502, 'TRACE_PLAN_INVALID')
  return families
}

// Server-owned coverage describes actual reads, including reads nested in presentation tools.
function traceToolCoverage(name,args={}) {
  if(['query_orders','get_order','open_order'].includes(name))return ['orders']
  if(name==='query_mail_insights')return !['jobs',''].includes(args.category) ? ['mailInsights'] : args.kind === 'applications' ? ['applications','mailInsights'] : args.kind === 'opportunities' ? ['opportunities','mailInsights'] : ['applications','opportunities','mailInsights']
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
function traceToolsForCoverage(requiredFamilies = []) {
  const families = {
    query_accounts: ['accounts'], get_account: ['accounts'], open_account: ['accounts'], focus_entity: ['accounts','subscriptions'],
    query_subscriptions: ['subscriptions'], show_subscriptions: ['subscriptions'], query_orders: ['orders'], get_order: ['orders'], open_order: ['orders'],
    query_mail_insights: ['applications','opportunities','mailInsights'], privacy_overview: ['actions','health','security'], workspace_status: ['status'],
  }
  const always = new Set(['finish_answer','calculate','navigate_to_page','close_preview'])
  const required = new Set(requiredFamilies)
  return traceTools.filter(tool => always.has(tool.function.name) || (families[tool.function.name] || []).some(family => required.has(family))).map(providerTool)
}

// Strict function schemas on Azure/OpenAI reject several JSON-Schema keywords (for example
// maxLength), which failed every tool round with a provider 400. Bounds stay enforced by
// validateTool on the server; the provider only receives the portable subset.
const providerOnlyDropped = new Set(['maxLength', 'minLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'pattern'])
function portableSchema(value) {
  if (Array.isArray(value)) return value.map(portableSchema)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !providerOnlyDropped.has(key)).map(([key, item]) => [key, key === 'properties' ? Object.fromEntries(Object.entries(item).map(([name, rule]) => [name, portableSchema(rule)])) : portableSchema(item)]))
}
function providerTool(tool) {
  return { ...tool, function: { ...tool.function, parameters: portableSchema(tool.function.parameters) } }
}

// Models (notably Mercury, which does not enforce strict schemas) often omit optional-looking
// fields, send null, send "2" for a page or use near-miss values. Repair only unambiguous
// shapes before strict validation, instead of rejecting the call and burning a tool round.
const statusAliases = { rejection: 'rejected', rejections: 'rejected', reject: 'rejected', declined: 'rejected', interviews: 'interview', interviewing: 'interview', interview_scheduled: 'interview', offers: 'offer', assessments: 'assessment', test: 'assessment', applied: 'application_received', application: 'application_received', applications: 'application_received', withdrawal: 'withdrawn', withdraw: 'withdrawn', all: '', any: '' }
const genericSearchWords = { query_accounts: /\b(accounts?|subscriptions?|logins?|profiles?)\b/gi, query_mail_insights: /\b(applications?|jobs?|e-?mails?|mails?|updates?|status(es)?)\b/gi, query_orders: /\b(orders?|purchases?|deliver(y|ies)|shipments?|packages?|my)\b/gi, query_subscriptions: /\b(subscriptions?|subs|plans?|memberships?|billing|my)\b/gi }
function normalizeToolArgs(name, raw) {
  const tool = traceTools.find((item) => item.function.name === name)
  if (!tool || !raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const fields = tool.function.parameters.properties
  // Unknown keys are kept so validation still rejects them.
  const args = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null && value !== undefined))
  for (const [key, rule] of Object.entries(fields)) {
    let value = args[key]
    if (rule.type === 'integer' && typeof value === 'string' && /^\s*\d{1,5}\s*$/.test(value)) value = Number(value)
    if (rule.type === 'string' && typeof value === 'string') value = value.trim()
    if (value === undefined && key === 'page') value = 1
    if (value === undefined && rule.type === 'string' && !rule.pattern && (!rule.enum || rule.enum.includes(''))) value = ''
    if (value !== undefined) args[key] = value
  }
  if (genericSearchWords[name] && typeof args.search === 'string' && args.search) {
    const stripped = args.search.replace(genericSearchWords[name], ' ').replace(/\s+/g, ' ').trim()
    if (stripped) args.search = stripped
    // A search made only of generic words ("my orders", "subscriptions") means list everything.
    else if (['query_orders', 'query_subscriptions'].includes(name)) args.search = ''
  }
  if (name === 'query_mail_insights') {
    if (typeof args.category === 'string') { const category = args.category.toLowerCase(); args.category = category === 'all' ? '' : category === 'job' ? 'jobs' : category }
    if (typeof args.status === 'string') { const status = args.status.toLowerCase().replace(/[\s-]+/g, '_'); args.status = Object.hasOwn(statusAliases, status) ? statusAliases[status] : status }
    if (args.kind === undefined) args.kind = 'all'
  }
  if (name === 'finish_answer') {
    if (args.view === undefined) args.view = 'none'
    if (args.entityId === undefined) args.entityId = ''
    // An explicit chat choice wins (never open a page the model chose not to show); otherwise a
    // concrete view is the model's request to show something.
    if (args.presentation === 'chat' || args.view === 'none') { args.presentation = 'chat'; args.view = 'none'; args.entityId = '' } else args.presentation = 'preview'
    if (args.presentation === 'preview') {
      if (args.entityId && args.view === 'accounts') args.view = 'account'
      else if (args.entityId && args.view === 'subscriptions') args.view = 'subscription'
      else if (!args.entityId && args.view === 'account') args.view = 'accounts'
      else if (!args.entityId && args.view === 'subscription') args.view = 'subscriptions'
      else if (!['account', 'subscription'].includes(args.view)) args.entityId = ''
    }
  }
  return args
}
function parseToolArguments(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw !== 'string') throw new SyntaxError('Tool arguments must be JSON')
  return raw.trim() ? JSON.parse(raw) : {}
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
function mailInsightAction(query) {
  const category = query.category ?? 'jobs'
  const args = { category, kind: query.kind ?? (category === 'jobs' ? 'applications' : 'all'), status: query.status ?? '', search: query.search ?? '', page: query.page ?? 1 }
  validateTool('query_mail_insights', args)
  if (!/^[a-z_]{0,60}$/.test(args.status)) throw new AppError('Invalid mail status filter.', 400, 'INVALID_TRACE_TOOL')
  return { type: 'show_mail_insights', ...args }
}
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
    data = await listOrderCards(userId, { page: args.page, limit: 12, search: args.search || '' })
    sources.push(source('Order email events', { type: 'navigate_to_page', page: 'orders' }))
    sources.push(...data.orders.map(item => source(item.merchant.name + ' · order evidence', { type: 'open_order', orderId: item.id })))
  } else if (name === 'query_mail_insights') {
    const { queryMailInsights } = await import('./mail-insight-query.service.js')
    data = await queryMailInsights(userId, args)
    const label = args.status ? `${args.status.replaceAll('_', ' ')} updates` : args.kind === 'applications' ? 'Application updates' : args.kind === 'opportunities' ? 'Job recommendations' : 'Email updates'
    sources.push(source(label.charAt(0).toUpperCase() + label.slice(1), mailInsightAction(args)))
  } else if (['get_order','open_order'].includes(name)) {
    data = await orderDetails(userId, args.orderId)
    sources.push(source(data.order.merchant.name + ' · order evidence', { type: 'open_order', orderId: data.order.id }))
    if(name === 'open_order')actions.push({ type: 'open_order', orderId: data.order.id })
  } else if (['query_subscriptions', 'show_subscriptions'].includes(name)) {
    data = await listSubscriptions(userId, name === 'query_subscriptions' && args.search ? { ...query, search: args.search } : query)
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
    // verifiedBreachCheck is the saved XposedOrNot lookup for the account email: the authoritative
    // answer to "was my email leaked". breaches/exposures are mail-derived signals only.
    if (args.section === 'security') data = { verifiedBreachCheck: serializeBreachReport(await getBreachReportForUser(userId)), breaches: await listBreachInsights(userId, query), exposures: await listExposureInsights(userId, query) }
    sources.push(source(`OwnTrace ${args.section}`, { type: 'navigate_to_page', page: { health: 'privacy-health', actions: 'privacy-inbox', security: 'breaches' }[args.section] }))
  } else if (name === 'workspace_status') {
    const connectionFields = 'status connectedAt lastSyncAt lastErrorCode -_id'
    const jobFields = 'status processedCount storedCount estimatedTotal startedAt completedAt lastErrorCode -_id'
    const [google, microsoft, gmailScan, microsoftScan, mailAnalysis] = await Promise.all([
      GoogleConnection.findOne({ userId }).select(connectionFields).lean(), MicrosoftConnection.findOne({ userId }).select(connectionFields).lean(),
      GmailSyncJob.findOne({ userId }).select(jobFields).lean(), MicrosoftSyncJob.findOne({ userId }).select(jobFields).lean(),
      MailAnalysis.findOne({ userId }).select('enabled status provider processed limit updatedAt lastErrorCode enrichmentStatus enrichmentProcessed enrichmentErrorCode -_id').lean(),
    ])
    data = { google, microsoft, gmailScan, microsoftScan, mailAnalysis, observedAt: new Date().toISOString() }
    sources.push(source('Mail connections and scan status', { type: 'navigate_to_page', page: 'connect' }))
  } else {
    data = { page: args.page }
    actions.push({ type: 'navigate_to_page', page: args.page })
  }
  return { coverage:traceToolCoverage(name,args), resultSummary:summarizeTraceResult(data), query:args, data, sources, actions, retrievedAt: new Date().toISOString() }
}
export { executeTraceTool, traceTools, traceToolsForCoverage, validateTool, normalizeToolArgs, mailStatuses, parseToolArguments, traceToolCoverage, tracePlanTool, validateTracePlan, pages, mailInsightAction }
