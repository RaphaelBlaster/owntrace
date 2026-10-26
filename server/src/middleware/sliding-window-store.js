// Exact rolling window for the single Node process. Rejected hits do not extend it.
export default class SlidingWindowStore {
  localKeys = true
  hits = new Map()

  init({ windowMs, limit }) {
    this.windowMs = windowMs
    this.limit = limit
    this.timer = setInterval(() => {
      for (const key of this.hits.keys()) this.prune(key)
    }, windowMs)
    this.timer.unref()
  }

  prune(key) {
    const hits = (this.hits.get(key) || []).filter(time => time > Date.now() - this.windowMs)
    if (hits.length) this.hits.set(key, hits)
    else this.hits.delete(key)
    return hits
  }

  increment(key) {
    const hits = this.prune(key)
    if (hits.length >= this.limit) {
      return { totalHits: this.limit + 1, resetTime: new Date(hits[0] + this.windowMs) }
    }
    hits.push(Date.now())
    this.hits.set(key, hits)
    return { totalHits: hits.length, resetTime: new Date(hits[0] + this.windowMs) }
  }

  decrement(key) {
    const hits = this.prune(key)
    hits.pop()
    if (!hits.length) this.hits.delete(key)
  }

  resetKey(key) { this.hits.delete(key) }
  shutdown() { clearInterval(this.timer); this.hits.clear() }
}
