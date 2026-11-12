// OWNTRACE_ROLE splits one image into separate processes:
//   all    (default) HTTP API + every background worker in one process
//   web    HTTP API only; scans, syncs and replays run in the worker role
//   worker background workers + a loopback-only health endpoint, no API
//   api / mail-worker  aliases of web / worker for the split deployment
//   rag    marker only: compose runs trace-server.js directly for this role
const aliases = { api: 'web', 'mail-worker': 'worker' }
const validRoles = new Set(['all', 'web', 'worker', 'api', 'mail-worker', 'rag'])

export function getOwntraceRole() {
  const role = process.env.OWNTRACE_ROLE?.trim().toLowerCase() || 'all'
  if (!validRoles.has(role)) throw new Error('OWNTRACE_ROLE must be all, web, worker, api, mail-worker, or rag')
  return role
}

const base = (role) => aliases[role] || role
export function roleServesApi(role = getOwntraceRole()) { return ['all', 'web'].includes(base(role)) }
export function roleRunsWorkers(role = getOwntraceRole()) { return ['all', 'worker'].includes(base(role)) }

// The worker health listener stays inside the container: the image HEALTHCHECK
// calls it on 127.0.0.1, so it binds loopback unless explicitly overridden.
export function getWorkerHealthHost() {
  const host = process.env.OWNTRACE_WORKER_HEALTH_HOST?.trim() || '127.0.0.1'
  if (!['127.0.0.1', '::1', '0.0.0.0'].includes(host)) throw new Error('OWNTRACE_WORKER_HEALTH_HOST must be a loopback or container bind address')
  return host
}
