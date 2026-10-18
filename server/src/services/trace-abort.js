// Bound waiting without claiming that existing Mongo queries themselves are cancelled.
function awaitTraceOperation(operation, signal) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason || new DOMException('Stopped', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation() }).then((result) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason || new DOMException('Stopped', 'AbortError'))
      else resolve(result)
    }, (error) => {
      signal.removeEventListener('abort', abort)
      reject(error) // Eventual errors remain observed even if the caller already aborted.
    })
    if (signal.aborted) abort()
  })
}
export { awaitTraceOperation }
