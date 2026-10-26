const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160)
const redacted = value => /\[(?:phone|email|link|auth code)\]/i.test(value || '')
const labels = {
  application_received: ['application confirmation', 'application confirmations', 'application received'],
  rejected: ['rejection update', 'rejection updates', 'rejected'],
  interview: ['interview update', 'interview updates', 'interview update'],
  assessment: ['assessment', 'assessments', 'assessment'],
  offer: ['offer update', 'offer updates', 'offer received'],
  withdrawn: ['withdrawal update', 'withdrawal updates', 'withdrawn'],
}
const join = items => items.length < 2 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
const covers = (a, b) => (!a.category || a.category === b.category) && (a.search || '') === (b.search || '') && (a.kind === 'all' || a.kind === b.kind) && (!a.status || a.status === b.status)

// Facts remain server-owned; overlapping tool lookups should not become repeated reports.
export function renderTraceMailAnswer(results, detail = 'medium') {
  const primary = results.filter((item, index) => !results.some((other, otherIndex) => otherIndex !== index && covers(other.query, item.query) && (!covers(item.query, other.query) || otherIndex < index)))
  const paragraphs = primary.map(({ query, data }) => {
    const { counts, scan } = data
    const recommendations = query.kind === 'opportunities'
    const kind = recommendations ? 'job recommendations' : query.kind === 'applications' ? 'application-related emails' : query.category === 'jobs' ? 'job-related emails' : 'relevant emails'
    const scope = query.search ? ` matching “${clean(query.search)}”` : ''
    const window = scan.status === 'COMPLETED' ? ` in your latest ${scan.processed} inbox emails` : ' in the saved results available so far'
    if (scan.status === 'NOT_SCANNED') return 'I haven’t analyzed your mailbox yet, so I can’t tell which applications have received replies.'
    if (!counts.messages) return `I haven’t found any saved ${query.status ? clean(query.status).replaceAll('_', ' ') + ' updates' : kind}${scope} in this window. That doesn’t establish that you received no replies.`
    const lines = [`I found ${counts.messages} ${counts.messages === 1 ? kind.replace(/emails$/, 'email').replace(/recommendations$/, 'recommendation') : kind}${scope}${window}${query.status ? ` with a latest saved status of ${labels[query.status]?.[2] || clean(query.status).replaceAll('_', ' ')}` : ''}.`]
    if (!recommendations) {
      const statuses = counts.eventStatuses || counts.currentStatuses || {}
      const parts = Object.entries(labels).filter(([key]) => statuses[key] > 0).map(([key, words]) => `${statuses[key]} ${words[statuses[key] === 1 ? 0 : 1]}`)
      if (parts.length) lines.push(`The messages include ${join(parts)}.`)
      if (query.kind === 'all' && counts.opportunities) lines.push(`Those results include ${counts.opportunities} job recommendations, rather than application confirmations.`)
    }
    const examples = new Map()
    const lookups = results.filter(item => covers(query, item.query)).sort((a, b) => Number(Boolean(b.query.status)) - Number(Boolean(a.query.status)))
    const items = lookups.flatMap(lookup => lookup.data.insights).sort((a, b) => Number(b.status !== 'unknown') - Number(a.status !== 'unknown'))
    for (const item of items) {
      const company = clean(item.company?.name), role = redacted(item.role) ? '' : clean(item.role)
      const name = company ? `${company}${role ? ` — ${role}` : ''}` : role ? `${role} (company not identified)` : redacted(item.title) ? 'An email with no identified company' : clean(item.title) || 'An email with no identified company'
      const status = item.kind === 'opportunity' ? 'job recommendation' : labels[item.status]?.[2] || 'status isn’t clear yet'
      if (company && !role && [...examples.keys()].some(key => key.startsWith(company + ' — ') && key.endsWith(':' + status))) continue
      if (company && role) examples.delete(`${company}:${status}`)
      examples.set(`${name}:${status}`, `• ${name}: ${status}.`)
    }
    const shown = [...examples.values()].slice(0, detail === 'low' ? 1 : detail === 'high' ? 5 : 3)
    if (shown.length) lines.push(`A few examples:\n${shown.join('\n')}`)
    return lines.join('\n\n')
  })
  const scans = results.map(item => item.data.scan), counts = results.map(item => item.data.counts)
  const notes = []
  if (scans.some(scan => ['QUEUED', 'RUNNING'].includes(scan.status) || ['QUEUED', 'RUNNING'].includes(scan.enrichmentStatus))) notes.push('Some messages are still being analyzed, so this summary may change.')
  else if (counts.some(count => count.enrichmentPending)) notes.push('Some messages still need review.')
  if (counts.some(count => count.unresolved) || scans.some(scan => scan.unresolvedMessages)) notes.push('Some updates couldn’t be linked to an application.')
  if (results.some(item => item.query.kind !== 'opportunities' && item.data.counts.applicationResults)) notes.push('These are email updates, not a count of separate applications.')
  if (notes.length) paragraphs.push(notes.join(' '))
  paragraphs.push('Open Jobs below to see the full list and evidence.')
  if (!results.some(item => item.query.status === 'rejected') && primary.some(item => !item.query.status && (item.data.counts.eventStatuses?.rejected || item.data.counts.currentStatuses?.rejected))) paragraphs.push('Would you like me to show just the rejections?')
  return paragraphs.join('\n\n')
}
