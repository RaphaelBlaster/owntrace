// Silently asks the server to enqueue an incremental mailbox sync when the
// authenticated workspace opens, and again when the tab comes back after being
// hidden for more than a minute. Errors are ignored; there is no UI.
const HIDDEN_THRESHOLD_MS = 60_000
const MIN_INTERVAL_MS = 30_000

function createMailRefresher({ request, now = () => Date.now(), minIntervalMs = MIN_INTERVAL_MS, hiddenThresholdMs = HIDDEN_THRESHOLD_MS }) {
  let lastSentAt = -Infinity, hiddenAt = null, inFlight = false
  function trigger() {
    const at = now()
    if (inFlight || at - lastSentAt < minIntervalMs) return false
    lastSentAt = at; inFlight = true
    Promise.resolve().then(request).catch(() => {}).finally(() => { inFlight = false })
    return true
  }
  return {
    trigger,
    hidden() { if (hiddenAt === null) hiddenAt = now() },
    visible() {
      const was = hiddenAt
      hiddenAt = null
      return was !== null && now() - was > hiddenThresholdMs ? trigger() : false
    },
  }
}

export { createMailRefresher }
