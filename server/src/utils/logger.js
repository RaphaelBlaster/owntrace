function shouldLog(level) {
  if (process.env.NODE_ENV === 'test') return false
  const configuredLevel = process.env.LOG_LEVEL?.trim() || 'info'
  if (configuredLevel === 'silent') return false
  return level === 'error' || configuredLevel === 'info'
}

function logEvent(level, event, details = {}) {
  if (!shouldLog(level)) return
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  })
  const stream = level === 'error' ? process.stderr : process.stdout
  stream.write(`${payload}\n`)
}

export { logEvent }
