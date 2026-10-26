const statusLabels = { application_received: 'Application received', assessment: 'Assessment', interview: 'Interview', offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn', unknown: 'Unspecified' }
const text = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160)
const status = value => statusLabels[value] || text(value).replaceAll('_', ' ') || 'Unspecified'
const distribution = counts => Object.entries(counts || {}).filter(([, count]) => Number.isInteger(count) && count > 0).map(([key, count]) => `${status(key)}: ${count}`).join('; ') || 'No classified statuses in these matching saved records.'

// Personal mail facts come directly from owned query results, never generated prose.
export function renderTraceMailAnswer(results) {
  return results.map(({ query, data }) => {
    const { counts, pagination, scan, insights } = data
    const kind = query.kind === 'applications' ? 'application' : query.kind === 'opportunities' ? 'opportunity' : query.category === 'jobs' ? 'job-related' : 'mail'
    const lines = [
      `Saved ${kind} email records${query.status ? ` filtered to ${status(query.status)}` : ''}${query.search ? ` matching “${text(query.search)}”` : ''}:`,
      `${pagination.total} matching record groups from ${counts.messages} messages. ${counts.applications} groups are linked by application reference or thread; this is not a verified application count.`,
      `${counts.applicationResults || 0} matching groups contain application-related updates; ${counts.opportunities || 0} are opportunity alerts or invitations. These are distinct from a unique-application total.`,
      `Latest saved status across all matching groups: ${distribution(counts.currentStatuses)}`,
      `Historical saved events across all matching groups: ${distribution(counts.eventStatuses)}`,
    ]
    if (counts.unresolved) lines.push(`${counts.unresolved} matching job messages have ambiguous application linkage; they are not established as distinct applications.`)
    if (scan.unresolvedMessages > (counts.unresolved || 0)) lines.push(`${scan.unresolvedMessages} job messages across the saved scan have ambiguous linkage, including messages outside this filter.`)
    if (counts.enrichmentPending) lines.push(`${counts.enrichmentPending} saved job messages have not received the latest company/application enrichment. Missing status information cannot establish that no updates exist.`)
    if (['QUEUED', 'RUNNING'].includes(scan.enrichmentStatus)) lines.push(`Company/application enrichment is ${scan.enrichmentStatus.toLowerCase()}; ${scan.enrichmentProcessed || 0} messages checked in that pass.`)
    if (scan.status !== 'COMPLETED') lines.push(`Scan coverage is ${String(scan.status || 'NOT_SCANNED').toLowerCase().replaceAll('_', ' ')}: ${scan.processed || 0} of at most ${scan.limit || 250} inbox messages checked.`)
    else lines.push(`Scan window: ${scan.processed} inbox messages checked, with a limit of ${scan.limit || 250}. This does not establish complete application history.`)
    if (insights.length) {
      lines.push(`Examples from page ${pagination.page} of ${pagination.pages} (${insights.length} of ${pagination.total} matching groups):`)
      for (const item of insights) lines.push(`• ${text(item.company?.name) || 'Company not identified'}${item.role ? ` — ${text(item.role)}` : ''}: ${status(item.status)}; ${item.messageCount} saved email event${item.messageCount === 1 ? '' : 's'}${item.match === 'unresolved' && item.kind !== 'opportunity' ? '; application linkage unresolved' : ''}.`)
    }
    lines.push('These are email-derived findings, not employer-verified statuses. Open Top K to inspect the evidence and further pages.')
    return lines.join('\n')
  }).join('\n\n')
}
