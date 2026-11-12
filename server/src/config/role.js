// OWNTRACE_ROLE splits one image into separate processes:
//   all    (default) HTTP API + every background worker in one process
//   web    HTTP API only; scans, syncs and replays run in the worker role
//   worker background workers + a loopback-only health endpoint, no API
const validRoles = new Set(['all', 'web', 'worker'])

export function getOwntraceRole() {
  const role = process.env.OWNTRACE_ROLE?.trim().toLowerCase() || 'all'
  if (!validRoles.has(role)) throw new Error('OWNTRACE_ROLE must be all, web, or worker')
  return role
}

export function roleServesApi(role = getOwntraceRole()) { return role !== 'worker' }
export function roleRunsWorkers(role = getOwntraceRole()) { return role !== 'web' }

// The worker health listener stays inside the container: the image HEALTHCHECK
// calls it on 127.0.0.1, so it binds loopback unless explicitly overridden.
export function getWorkerHealthHost() {
  const host = process.env.OWNTRACE_WORKER_HEALTH_HOST?.trim() || '127.0.0.1'
  if (!['127.0.0.1', '::1', '0.0.0.0'].includes(host)) throw new Error('OWNTRACE_WORKER_HEALTH_HOST must be a loopback or container bind address')
  return host
}
