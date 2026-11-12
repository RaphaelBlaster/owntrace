import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

const calls = []
const stopper = (name) => vi.fn(async () => { calls.push(`stop:${name}`) })
const stops = {}
vi.mock('../src/services/mail-sync-worker.service.js', () => ({ startMailSyncWorker: vi.fn(() => { calls.push('start:mailSync'); return (stops.mailSync = stopper('mailSync')) }) }))
vi.mock('../src/services/top-k.service.js', async (original) => ({ ...await original(), startTopKWorker: vi.fn(() => { calls.push('start:topK'); return (stops.topK = stopper('topK')) }) }))
vi.mock('../src/services/order-scan.service.js', async (original) => ({ ...await original(), initializeOrderStorage: vi.fn(async () => { calls.push('init:order') }), startOrderWorker: vi.fn(() => { calls.push('start:order'); return (stops.order = stopper('order')) }) }))
vi.mock('../src/services/order-write-buffer.service.js', async (original) => ({ ...await original(), startOrderWriteBufferWorker: vi.fn(() => { calls.push('start:writeBuffer'); return (stops.writeBuffer = stopper('writeBuffer')) }) }))

const { getOwntraceRole, getWorkerHealthHost, roleRunsWorkers, roleServesApi } = await import('../src/config/role.js')
const { createWorkerHealthServer, startBackgroundWorkers } = await import('../src/worker.js')

afterEach(() => { vi.unstubAllEnvs(); calls.length = 0 })

describe('OWNTRACE_ROLE config', () => {
  it('defaults to all and validates the value', () => {
    vi.stubEnv('OWNTRACE_ROLE', '')
    expect(getOwntraceRole()).toBe('all')
    vi.stubEnv('OWNTRACE_ROLE', ' Worker ')
    expect(getOwntraceRole()).toBe('worker')
    vi.stubEnv('OWNTRACE_ROLE', 'api')
    expect(() => getOwntraceRole()).toThrow(/OWNTRACE_ROLE/)
  })
  it('maps roles to API and worker responsibilities', () => {
    expect([roleServesApi('all'), roleRunsWorkers('all')]).toEqual([true, true])
    expect([roleServesApi('web'), roleRunsWorkers('web')]).toEqual([true, false])
    expect([roleServesApi('worker'), roleRunsWorkers('worker')]).toEqual([false, true])
  })
  it('keeps the worker health listener container-local', () => {
    vi.stubEnv('OWNTRACE_WORKER_HEALTH_HOST', '')
    expect(getWorkerHealthHost()).toBe('127.0.0.1')
    vi.stubEnv('OWNTRACE_WORKER_HEALTH_HOST', '203.0.113.5')
    expect(() => getWorkerHealthHost()).toThrow()
  })
})

describe('background workers', () => {
  it('starts every loop and stops producers before the write buffer', async () => {
    vi.stubEnv('ORDER_WORKER_ENABLED', 'true')
    vi.stubEnv('ORDER_REDIS_URL', 'redis://127.0.0.1:6379/0')
    const stop = await startBackgroundWorkers()
    expect(calls).toEqual(['start:mailSync', 'start:topK', 'init:order', 'start:order', 'start:writeBuffer'])
    calls.length = 0
    await Promise.all([stop(), stop()])
    expect(calls).toEqual(['stop:order', 'stop:mailSync', 'stop:topK', 'stop:writeBuffer'])
  })
  it('skips optional loops that are disabled', async () => {
    vi.stubEnv('ORDER_WORKER_ENABLED', 'false')
    vi.stubEnv('ORDER_REDIS_URL', '')
    await (await startBackgroundWorkers())()
    expect(calls).toEqual(['start:mailSync', 'start:topK', 'stop:mailSync', 'stop:topK'])
  })
  it('stops already-started loops when order storage fails to initialize', async () => {
    vi.stubEnv('ORDER_WORKER_ENABLED', 'true')
    vi.stubEnv('ORDER_REDIS_URL', '')
    const { initializeOrderStorage } = await import('../src/services/order-scan.service.js')
    initializeOrderStorage.mockImplementationOnce(async () => { calls.push('init:order'); throw new Error('index build failed') })
    await expect(startBackgroundWorkers()).rejects.toThrow('index build failed')
    expect(calls).toEqual(['start:mailSync', 'start:topK', 'init:order', 'stop:mailSync', 'stop:topK'])
  })
  it('importing the API app starts no background worker', async () => {
    calls.length = 0
    await import('../src/app.js')
    expect(calls).toEqual([])
  })
})

describe('web role push intake', () => {
  it('only records a durable queued job; no provider call runs in the request', async () => {
    const { default: mongoose } = await import('mongoose')
    const { default: GoogleConnection } = await import('../src/models/google-connection.model.js')
    const { default: GmailSyncJob } = await import('../src/models/gmail-sync-job.model.js')
    const { queuePushSync } = await import('../src/services/mail-push-sync.service.js')
    const fetchMock = vi.fn(() => { throw new Error('no network in push intake') })
    vi.stubGlobal('fetch', fetchMock)
    const userId = new mongoose.Types.ObjectId()
    await GoogleConnection.create({ userId, googleAccountId: 'web-role-push', email: 'web-role@example.com', encryptedAccessToken: 'encrypted-access', encryptedRefreshToken: 'encrypted-refresh', tokenExpiresAt: new Date(Date.now() + 3_600_000) })
    await queuePushSync('gmail', userId)
    await queuePushSync('gmail', userId)
    const job = await GmailSyncJob.findOne({ userId }).select('+pushPending').lean()
    expect(job).toMatchObject({ status: 'QUEUED', processedCount: 0, pushPending: true })
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('worker health server', () => {
  it('serves only the health paths', async () => {
    let ready = false
    const server = createWorkerHealthServer({ isReady: () => ready })
    expect((await request(server).get('/api/health')).status).toBe(200)
    expect((await request(server).get('/api/health/ready')).status).toBe(503)
    ready = true
    expect((await request(server).get('/api/health/ready')).body).toEqual({ success: true, status: 'ready' })
    expect((await request(server).get('/api/auth/me')).status).toBe(404)
    expect((await request(server).get('/api/google/sync')).status).toBe(404)
    expect((await request(server).post('/api/notifications/google').send({})).status).toBe(405)
  })
})
