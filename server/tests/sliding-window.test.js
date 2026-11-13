import express from 'express'
import request from 'supertest'
import { rateLimit } from 'express-rate-limit'
import { afterEach, expect, it, vi } from 'vitest'
import SlidingWindowStore from '../src/middleware/sliding-window-store.js'
import { apiRateLimiter, mailStatusRateLimiter } from '../src/middleware/security.middleware.js'

afterEach(() => vi.restoreAllMocks())

it('expires requests individually and does not extend the window on rejection', () => {
  let now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const store = new SlidingWindowStore()
  store.init({ windowMs: 1000, limit: 2 })
  expect(store.increment('a').totalHits).toBe(1)
  now = 500
  expect(store.increment('a').totalHits).toBe(2)
  now = 999
  expect(store.increment('a')).toEqual({ totalHits: 3, resetTime: new Date(1000) })
  now = 1000
  expect(store.increment('a')).toEqual({ totalHits: 2, resetTime: new Date(1500) })
  expect(store.increment('b').totalHits).toBe(1)
  store.shutdown()
})

it('returns Retry-After and allows requests as the oldest hit expires', async () => {
  let now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const store = new SlidingWindowStore()
  const app = express().use(rateLimit({ windowMs: 1000, limit: 2, store })).get('/', (_req, res) => res.sendStatus(200))
  await request(app).get('/').expect(200)
  now = 500
  await request(app).get('/').expect(200)
  const blocked = await request(app).get('/').expect(429)
  expect(blocked.headers['retry-after']).toBe('1')
  now = 1000
  await request(app).get('/').expect(200)
  await request(app).get('/').expect(429)
  store.shutdown()
})

it('keeps mail status throttling separate from the workspace allowance', async () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const app = express()
    app.use('/api', apiRateLimiter, mailStatusRateLimiter)
    app.get('/api/google/sync', (_req, res) => res.sendStatus(200))
    app.get('/api/accounts', (_req, res) => res.sendStatus(200))
    for (let i = 0; i < 60; i++) await request(app).get('/api/google/sync').expect(200)
    await request(app).get('/api/google/sync').expect(429)
    for (let i = 0; i < 200; i++) await request(app).get('/api/accounts').expect(200)
    await request(app).get('/api/accounts').expect(429)
  } finally { process.env.NODE_ENV = original }
})
