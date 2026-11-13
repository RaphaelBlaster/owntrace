import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import mongoose from 'mongoose'
import GmailSignal from '../src/models/gmail-signal.model.js'
import MicrosoftSignal from '../src/models/microsoft-signal.model.js'
import OrderEvent from '../src/models/order-event.model.js'
import OrderReceipt from '../src/models/order-receipt.model.js'
import { bufferOrderWrites } from '../src/services/order-write-buffer.service.js'
import {
  clearPendingReceipts,
  createOrderWriteBatch,
  findPendingReceipt,
  writeSignalPage,
} from '../src/services/order-write-batch.service.js'

// Redis is optional. The default test environment has no ORDER_REDIS_URL, so the
// append helper reports "not buffered" and Mongo must receive the same upserts.
vi.mock('../src/services/order-write-buffer.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  bufferOrderWrites: vi.fn(async () => false),
}))

const userId = new mongoose.Types.ObjectId()
const connectionId = new mongoose.Types.ObjectId()
const scope = (index) => ({ userId, provider: 'outlook', connectionId, messageIdHash: 'hash-' + index })
const eventFields = { fingerprint: 'fingerprint-1', merchantName: 'Shop', merchantDomain: 'shop.example', status: 'shipped', summary: 'Shipment reported.', occurredAt: new Date(), policyVersion: 1 }
const receiptFields = { fingerprint: 'fingerprint-1', policyVersion: 1, expiresAt: new Date(Date.now() + 86400000) }
const pageSignal = (index, extra = {}) => ({
  connectionId,
  messageIdHash: 'hash-' + index,
  threadIdHash: 'thread-' + index,
  senderEmail: 'billing@shop.example',
  senderDomain: 'shop.example',
  subjectSignal: 'order shipped',
  billingAmountMinor: 4200,
  billingCurrency: 'USD',
  billingCycle: 'MONTHLY',
  occurredAt: new Date('2026-01-05T00:00:00.000Z'),
  ...extra,
})

beforeEach(() => {
  vi.mocked(bufferOrderWrites).mockReset()
  vi.mocked(bufferOrderWrites).mockResolvedValue(false)
})
afterEach(() => { vi.restoreAllMocks(); clearPendingReceipts() })

describe('batched order page persistence', () => {
  it('writes accumulated events and receipts as one bulk write each, events first', async () => {
    const eventWrites = vi.spyOn(OrderEvent, 'bulkWrite')
    const receiptWrites = vi.spyOn(OrderReceipt, 'bulkWrite')
    const writes = createOrderWriteBatch()
    writes.event(scope(1), eventFields)
    writes.event(scope(2), { ...eventFields, status: 'delivered' })
    writes.receipt(scope(1), 'order', receiptFields)
    writes.receipt(scope(2), 'order', receiptFields)
    writes.receipt(scope(3), 'review', receiptFields)
    expect(await writes.flush()).toEqual({ events: 2, receipts: 3, signals: 0, buffered: false, upserted: 0 })
    expect(eventWrites).toHaveBeenCalledTimes(1)
    expect(receiptWrites).toHaveBeenCalledTimes(1)
    expect(eventWrites.mock.invocationCallOrder[0]).toBeLessThan(receiptWrites.mock.invocationCallOrder[0])
    expect(eventWrites.mock.calls[0][1]).toEqual({ ordered: true })
    expect(eventWrites.mock.calls[0][0][0].updateOne).toMatchObject({ filter: scope(1), upsert: true })
    expect(await OrderEvent.countDocuments()).toBe(2)
    expect(await OrderReceipt.countDocuments()).toBe(3)
    expect(await writes.flush()).toEqual({ events: 0, receipts: 0, signals: 0, buffered: false, upserted: 0 })
    expect(eventWrites).toHaveBeenCalledTimes(1)
  })
  it('collapses repeated messages and stays idempotent across retries', async () => {
    const writes = createOrderWriteBatch()
    writes.event(scope(1), eventFields)
    writes.event(scope(1), { ...eventFields, status: 'delivered' })
    writes.receipt(scope(1), 'review', receiptFields)
    writes.receipt(scope(1), 'order', receiptFields)
    expect(await writes.flush()).toEqual({ events: 1, receipts: 1, signals: 0, buffered: false, upserted: 0 })
    expect((await OrderEvent.findOne()).status).toBe('delivered')
    expect((await OrderReceipt.findOne()).outcome).toBe('order')
    const replay = createOrderWriteBatch()
    replay.event(scope(1), { ...eventFields, status: 'delivered' })
    replay.receipt(scope(1), 'order', receiptFields)
    await replay.flush()
    expect(await OrderEvent.countDocuments()).toBe(1)
    expect(await OrderReceipt.countDocuments()).toBe(1)
  })
  it('never marks a message deduplicated when the event write fails', async () => {
    const receiptWrites = vi.spyOn(OrderReceipt, 'bulkWrite')
    vi.spyOn(OrderEvent, 'bulkWrite').mockRejectedValue(new Error('write conflict'))
    const writes = createOrderWriteBatch()
    writes.event(scope(1), eventFields)
    writes.receipt(scope(1), 'order', receiptFields)
    await expect(writes.flush()).rejects.toThrow('write conflict')
    expect(receiptWrites).not.toHaveBeenCalled()
    expect(await OrderReceipt.countDocuments()).toBe(0)
    expect(await OrderEvent.countDocuments()).toBe(0)
  })
  it('validates queued cards before any write reaches Mongo', async () => {
    const eventWrites = vi.spyOn(OrderEvent, 'bulkWrite')
    const writes = createOrderWriteBatch()
    writes.event(scope(1), { ...eventFields, status: 'not-a-status' })
    writes.receipt(scope(1), 'order', receiptFields)
    await expect(writes.flush()).rejects.toThrow()
    expect(eventWrites).not.toHaveBeenCalled()
    expect(bufferOrderWrites).not.toHaveBeenCalled()
    expect(await OrderReceipt.countDocuments()).toBe(0)
  })
})

describe('Redis-first write buffering', () => {
  it('appends sanitized envelopes to Redis before touching Mongo', async () => {
    vi.mocked(bufferOrderWrites).mockResolvedValue(true)
    const eventWrites = vi.spyOn(OrderEvent, 'bulkWrite')
    const receiptWrites = vi.spyOn(OrderReceipt, 'bulkWrite')
    const signalWrites = vi.spyOn(GmailSignal, 'bulkWrite')
    const writes = createOrderWriteBatch()
    writes.event(scope(1), eventFields)
    writes.receipt(scope(1), 'order', receiptFields)
    // Raw provider fields are dropped: only derived metadata is serialized.
    writes.signal('gmail', pageSignal(1, { body: 'raw body', snippet: 'raw snippet', accessToken: 'ya29.secret', refreshToken: 'refresh-secret' }), userId)
    const result = await writes.flush({ scanId: 'scan-1' })
    expect(result).toEqual({ events: 1, receipts: 1, signals: 1, buffered: true, upserted: 1, scanId: 'scan-1' })
    expect(eventWrites).not.toHaveBeenCalled()
    expect(receiptWrites).not.toHaveBeenCalled()
    expect(signalWrites).not.toHaveBeenCalled()
    expect(await OrderEvent.countDocuments()).toBe(0)
    expect(bufferOrderWrites).toHaveBeenCalledTimes(1)
    const envelopes = vi.mocked(bufferOrderWrites).mock.calls[0][0]
    expect(envelopes.map((envelope) => envelope.model)).toEqual(['OrderEvent', 'OrderReceipt', 'GmailSignal'])
    const serialized = JSON.stringify(envelopes)
    for (const forbidden of ['raw body', 'raw snippet', 'ya29.secret', 'refresh-secret', 'body', 'snippet']) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(envelopes[2].setOnInsert).toEqual({ connectionId, messageIdHash: 'hash-1', threadIdHash: 'thread-1', userId })
    expect(envelopes[2].set.subjectSignal).toBe('order shipped')
  })
  it('falls back to direct Mongo upserts when Redis is unavailable', async () => {
    const eventWrites = vi.spyOn(OrderEvent, 'bulkWrite')
    const writes = createOrderWriteBatch()
    writes.event(scope(1), eventFields)
    writes.receipt(scope(1), 'order', receiptFields)
    expect(await writes.flush()).toEqual({ events: 1, receipts: 1, signals: 0, buffered: false, upserted: 0 })
    expect(bufferOrderWrites).toHaveBeenCalledTimes(1)
    expect(eventWrites).toHaveBeenCalledTimes(1)
    expect(await OrderEvent.countDocuments()).toBe(1)
    expect(await OrderReceipt.countDocuments()).toBe(1)
  })
  it('keeps buffered receipts visible for dedupe until Mongo has them', async () => {
    const writes = createOrderWriteBatch()
    expect(findPendingReceipt(scope(1), 'fingerprint-1', 1)).toBe(false)
    writes.receipt(scope(1), 'order', receiptFields)
    expect(findPendingReceipt(scope(1), 'fingerprint-1', 1)).toBe(false)
    vi.mocked(bufferOrderWrites).mockResolvedValue(true)
    await writes.flush()
    expect(findPendingReceipt(scope(1), 'fingerprint-1', 1)).toBe(true)
    expect(findPendingReceipt(scope(1), 'fingerprint-2', 1)).toBe(false)
    expect(findPendingReceipt(scope(2), 'fingerprint-1', 1)).toBe(false)
    expect(findPendingReceipt(scope(1), 'fingerprint-1', 2)).toBe(false)
    clearPendingReceipts()
    expect(findPendingReceipt(scope(1), 'fingerprint-1', 1)).toBe(false)
  })
})

describe('provider metadata pages', () => {
  it('writes a Gmail page as one unordered bulk write and returns the new count', async () => {
    const signalWrites = vi.spyOn(GmailSignal, 'bulkWrite')
    expect(await writeSignalPage('gmail', [pageSignal(1), pageSignal(2)], userId)).toBe(2)
    expect(signalWrites).toHaveBeenCalledTimes(1)
    expect(signalWrites.mock.calls[0][1]).toEqual({ ordered: false })
    const operation = signalWrites.mock.calls[0][0][0].updateOne
    expect(operation.upsert).toBe(true)
    expect(operation.update.$setOnInsert).toMatchObject({ threadIdHash: 'thread-1', userId })
    expect(operation.update.$set).toMatchObject({ senderDomain: 'shop.example', billingAmountMinor: 4200 })
    expect(await GmailSignal.countDocuments()).toBe(2)
    expect(await writeSignalPage('gmail', [], userId)).toBe(0)
    expect(signalWrites).toHaveBeenCalledTimes(1)
  })
  it('buffers a Microsoft page and carries the sync run id on insert', async () => {
    vi.mocked(bufferOrderWrites).mockResolvedValue(true)
    const signalWrites = vi.spyOn(MicrosoftSignal, 'bulkWrite')
    expect(await writeSignalPage('outlook', [pageSignal(1)], userId, { syncRunId: 'run-1' })).toBe(1)
    expect(signalWrites).not.toHaveBeenCalled()
    expect(await MicrosoftSignal.countDocuments()).toBe(0)
    const [envelope] = vi.mocked(bufferOrderWrites).mock.calls[0][0]
    expect(envelope.model).toBe('MicrosoftSignal')
    expect(envelope.setOnInsert.syncRunId).toBe('run-1')
    expect(envelope.filter).toEqual({ connectionId, messageIdHash: 'hash-1', userId })
  })
  it('rejects providers that have no buffered signal model', async () => {
    const writes = createOrderWriteBatch()
    expect(() => writes.signal('yahoo', pageSignal(1), userId)).toThrow(/cannot be buffered/)
  })
})
