// Server-owned semantics, separate from untrusted record text.
const interpretations = {
  orders:'Saved email order events, not unique purchase counts or live carrier status. Missing details remain unknown.',
  subscriptions:'Recurring-service metadata signals; active billing is not established.',
  accounts:'Discovered account inferences matching this query; current ownership is not established.',
  actions:'Recommendations matching the requested status/filter; not external account changes.',
  securitySignals:'Account metadata security signals; not verified breaches.',
  breaches:'Stored verified breach records; not proof of a current compromise.',
  exposureSignals:'Inferred exposure signals; not verified public exposure.',
}
export function summarizeTraceResult(data) {
  const facts=[]
  function collect(value) {
    if (!value || typeof value !== 'object') return
    for (const [resource,interpretation] of Object.entries(interpretations)) {
      if (!Array.isArray(value[resource])) continue
      const pagination=resource==='breaches' ? value.breachPagination : value.pagination
      if (!pagination || !Number.isInteger(pagination.total)) continue
      facts.push({ resource,totalRecords:pagination.total,returnedRecords:value[resource].length,page:pagination.page,pages:pagination.pages,partial:value[resource].length<pagination.total,interpretation })
    }
    for (const key of ['preview','breaches','exposures']) if (!Array.isArray(value[key])) collect(value[key])
  }
  collect(data)
  return facts
}
export const traceCapabilities = {
  supported:['Saved order email events and evidence timelines; not live carrier tracking','Discovered mail-metadata accounts and their supporting evidence','Inferred subscription records with supported amounts/currencies/cycles; active billing is unknown','Privacy recommendations and derived Privacy Health','Stored verified breach records, inferred security/exposure signals','Stored mail connection and scan status','Opening existing authorized OwnTrace pages and evidence','Showing or focusing a previously discussed OwnTrace record in the live side panel; closing or hiding that panel while keeping the conversation'],
  unavailable:['File storage, file edits or file activity history','Inspecting or changing third-party passwords, MFA or recovery settings','Cancelling or changing subscriptions or billing','Marking subscriptions/accounts reviewed; there is no such write API'],
  settings:'OwnTrace account information and account deletion; do not promise password, MFA or notification settings that are not implemented.',
  permissions:'TRACE tools retrieve and navigate only. Users may explicitly confirm supported recommendation status changes in the real UI. General privacy/MFA/billing advice is allowed, but external checks must be done by the user through each service.'
}
