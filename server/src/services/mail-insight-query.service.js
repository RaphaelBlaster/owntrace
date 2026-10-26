import { createHash } from 'node:crypto'
import { MailAnalysis, MailInsight } from '../models/mail-insight.model.js'

const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')
const companyDomains = { gevernova: 'gevernova.com', amazon: 'amazon.com', microsoft: 'microsoft.com', google: 'google.com', ibm: 'ibm.com', wayfair: 'wayfair.com', honeywell: 'honeywell.com', cargill: 'cargill.com', deloitte: 'deloitte.com', accenture: 'accenture.com', tataelxsi: 'tataelxsi.com', hcltech: 'hcltech.com', infosys: 'infosys.com', tcs: 'tcs.com', lufthansatechnik: 'lufthansa-technik.com' }
const atsDomains = new Set(['myworkday.com', 'workday.com', 'greenhouse.io', 'lever.co', 'joinsuperset.com', 'unstop.com'])
const applicationStatuses = new Set(['application_received', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn'])
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24)
function companyFor(row) {
  const name = row.companyName || null
  const supplied = row.companyDomain?.toLowerCase()
  const domain = companyDomains[normalized(name)] || (supplied && ![...atsDomains].some(ats => supplied === ats || supplied.endsWith('.' + ats)) ? supplied : null)
  return { name, domain, logoUrl: domain ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico` : null }
}

export function groupMailInsights(rows) {
  const groups = new Map()
  const referenceRoles = new Map()
  for (const row of rows) {
    if (row.category !== 'jobs' || row.referenceType !== 'application' || !row.applicationReference) continue
    const employer = normalized(row.companyName) || companyFor(row).domain || ''
    const key = `${employer}:${row.applicationReference}`
    if (!referenceRoles.has(key)) referenceRoles.set(key, new Set())
    if (row.roleName) referenceRoles.get(key).add(normalized(row.roleName))
  }
  for (const row of rows) {
    const company = companyFor(row), employer = normalized(company.name) || company.domain || ''
    const kind = row.category !== 'jobs' ? 'message' : row.eventKind === 'opportunity' ? 'opportunity' : row.eventKind === 'application' || applicationStatuses.has(row.status) ? 'application' : 'unresolved'
    const eventId = String(row._id || row.id)
    let key = `message:${eventId}`, match = 'unresolved'
    if (row.category === 'jobs' && kind === 'application' && employer) {
      if (row.applicationReference && row.referenceType === 'application') {
        const conflictingRoles = referenceRoles.get(`${employer}:${row.applicationReference}`).size > 1
        // Conflicting extracted roles cannot safely identify one application.
        if (!conflictingRoles || row.roleName) {
          key = `${employer}:application:${row.applicationReference}${conflictingRoles ? ':role:' + normalized(row.roleName) : ''}`; match = 'reference'
        }
      } else if (row.threadHash && row.roleName) {
        key = `${employer}:role:${normalized(row.roleName)}:thread:${row.threadHash}:reference:${row.applicationReference || ''}`; match = 'thread'
      }
    }
    const groupKey = `${row.category}:${kind}:${key}`
    if (!groups.has(groupKey)) groups.set(groupKey, { id: hash(groupKey), category: row.category, company, companyKey: employer || null, role: row.roleName || null, kind, match, events: [] })
    const group = groups.get(groupKey)
    if (!group.role && row.roleName) group.role = row.roleName
    group.events.push({ id: eventId, status: row.status || 'unknown', occurredAt: row.occurredAt, title: row.title, summary: row.summary, evidence: row.evidence, actionRequired: row.actionRequired, importance: row.importance || 1, senderDomain: row.senderDomain })
  }
  return [...groups.values()].map(group => {
    group.events.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt) || a.id.localeCompare(b.id))
    const latest = group.events.at(-1)
    const supported = group.events.filter(event => event.status !== 'unknown')
    const status = group.kind === 'opportunity' ? 'unknown' : supported.at(-1)?.status || 'unknown'
    return { ...group, title: group.company.name || latest.title || 'Company not identified', status, summary: latest.summary, occurredAt: latest.occurredAt, actionRequired: latest.actionRequired, importance: latest.importance, evidence: latest.evidence, senderDomain: latest.senderDomain, messageCount: group.events.length }
  }).sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt) || a.id.localeCompare(b.id))
}

export function paginateInsights(groups, { status = '', search = '', kind = 'all', page = 1, limit = 6 } = {}) {
  const needle = String(search).toLowerCase().trim()
  const matches = groups.filter(group => (!status || group.status === status) && (kind === 'all' || kind === 'applications' && group.kind === 'application' || kind === 'opportunities' && group.kind === 'opportunity') && (!needle || [group.company.name, group.role, group.title, group.summary, ...group.events.map(event => event.summary)].some(value => String(value || '').toLowerCase().includes(needle))))
  const currentStatuses = {}, eventStatuses = {}
  for (const group of matches) {
    currentStatuses[group.status] = (currentStatuses[group.status] || 0) + 1
    for (const event of group.events) eventStatuses[event.status] = (eventStatuses[event.status] || 0) + 1
  }
  return { insights: matches.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: matches.length, pages: Math.ceil(matches.length / limit) }, counts: { messages: matches.reduce((sum, x) => sum + x.messageCount, 0), applications: matches.filter(x => x.kind === 'application' && x.match !== 'unresolved').length, applicationResults: matches.filter(x => x.kind === 'application').length, unresolved: matches.filter(x => x.match === 'unresolved' && x.category === 'jobs' && x.kind !== 'opportunity').reduce((sum, x) => sum + x.messageCount, 0), opportunities: matches.filter(x => x.kind === 'opportunity').length, currentStatuses, eventStatuses } }
}

export function visibleMailScope(userId, analysis) {
  const runs = analysis.status !== 'COMPLETED' && analysis.previousRunId ? [analysis.runId, analysis.previousRunId] : [analysis.runId]
  return { userId, runId: { $in: runs }, ...(analysis.connectionId ? { connectionId: analysis.connectionId } : {}) }
}

export async function queryMailInsights(userId, { category = 'jobs', status = '', search = '', page = 1, limit = 6, kind = category === 'jobs' ? 'applications' : 'all' } = {}) {
  const analysis = await MailAnalysis.findOne({ userId }).lean()
  const rows = analysis?.runId ? await MailInsight.find({ ...visibleMailScope(userId, analysis), ...(category ? { category } : {}) }).sort({ occurredAt: -1 }).limit(250).lean() : []
  const groups = groupMailInsights(rows)
  const result = paginateInsights(groups, { status, search, page, limit, kind })
  result.counts.enrichmentPending = rows.filter(row => row.category === 'jobs' && (row.enrichmentVersion || 0) < 2).length
  const unresolvedMessages = groups.filter(group => group.category === 'jobs' && group.match === 'unresolved' && group.kind !== 'opportunity').reduce((sum, group) => sum + group.messageCount, 0)
  return { ...result, scan: analysis ? { status: analysis.status, processed: analysis.processed, limit: analysis.limit, provider: analysis.provider, observedAt: analysis.updatedAt, lastErrorCode: analysis.lastErrorCode, enrichmentStatus: analysis.enrichmentStatus || 'IDLE', enrichmentProcessed: analysis.enrichmentProcessed || 0, unresolvedMessages } : { status: 'NOT_SCANNED', processed: 0, limit: 250, unresolvedMessages: 0 } }
}
