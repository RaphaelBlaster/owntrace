import GmailSignal from '../models/gmail-signal.model.js'
import MicrosoftSignal from '../models/microsoft-signal.model.js'
import OrderEvent from '../models/order-event.model.js'
import OrderReceipt from '../models/order-receipt.model.js'
import { applyOrderWrites, bufferOrderWrites, orderWriteEnvelope } from './order-write-buffer.service.js'
import { logEvent } from '../utils/logger.js'

const signalModels = { gmail: GmailSignal, outlook: MicrosoftSignal }
const key = scope => `${scope.userId}:${scope.provider}:${scope.connectionId}:${scope.messageIdHash}`
const upsert = (filter, update) => ({ updateOne: { filter, update, upsert: true } })
// Buffered receipts reach Mongo a few seconds later than the scan that wrote
// them. Keep them visible in this process so a resumed scan still skips AI work
// for a message that was already examined; Mongo stays the durable record.
const pendingReceipts = []
const pendingWindowMs = 120000, pendingLimit = 500

export function findPendingReceipt(scope, fingerprint, policyVersion) {
  const earliest = Date.now() - pendingWindowMs
  return pendingReceipts.some(entry => entry.at > earliest && entry.fingerprint === fingerprint && entry.policyVersion === policyVersion && key(entry.scope) === key(scope))
}
export function clearPendingReceipts() { pendingReceipts.length = 0 }
function markPendingReceipts(entries) {
  for (const { scope, fields } of entries) {
    pendingReceipts.push({ scope, fingerprint: fields.fingerprint, policyVersion: fields.policyVersion, at: Date.now() })
  }
  if (pendingReceipts.length > pendingLimit) pendingReceipts.splice(0, pendingReceipts.length - pendingLimit)
}

// Accumulates one provider page of upserts so Mongo receives one bulk write per
// model instead of one write per message. Events are written before receipts: if
// an event write fails, no receipt can mark that message deduplicated.
export function createOrderWriteBatch() {
  const events = new Map(), receipts = new Map(), signals = []
  return {
    event(scope, fields) { events.set(key(scope), { scope, fields }) },
    receipt(scope, outcome, fields = {}) {
      receipts.set(key(scope), { scope, fields: { outcome, ...fields } })
    },
    // Provider page signals carry only derived metadata: hashed ids, sender
    // domain/email, the normalized subject signal, billing fields and a date.
    signal(provider, signal, userId, setOnInsert = {}) {
      const model = signalModels[provider]
      if (!model) throw new Error(`${provider} signals cannot be buffered`)
      signals.push({
        name: model.modelName, model,
        filter: { connectionId: signal.connectionId, messageIdHash: signal.messageIdHash, userId },
        set: { billingAmountMinor: signal.billingAmountMinor, billingCurrency: signal.billingCurrency, billingCycle: signal.billingCycle, occurredAt: signal.occurredAt, senderDomain: signal.senderDomain, senderEmail: signal.senderEmail, subjectSignal: signal.subjectSignal },
        setOnInsert: { connectionId: signal.connectionId, messageIdHash: signal.messageIdHash, threadIdHash: signal.threadIdHash, userId, ...setOnInsert },
      })
    },
    async flush(context = {}) {
      const eventEntries = [...events.values()], receiptEntries = [...receipts.values()], signalEntries = [...signals.values()]
      events.clear(), receipts.clear(), signals.length = 0
      // Keep the previous runValidators guarantee: an invalid card is rejected
      // before anything is appended to Redis or written to Mongo.
      for (const entry of eventEntries) await new OrderEvent({ ...entry.scope, ...entry.fields }).validate()
      const planned = []
      if (eventEntries.length) planned.push({ name: 'OrderEvent', model: OrderEvent, ops: eventEntries.map(({ scope, fields }) => upsert(scope, { $set: fields })) })
      if (receiptEntries.length) planned.push({ name: 'OrderReceipt', model: OrderReceipt, ops: receiptEntries.map(({ scope, fields }) => upsert(scope, { $set: fields })) })
      for (const entry of signalEntries) {
        let group = planned.find(item => item.name === entry.name)
        if (!group) { group = { name: entry.name, model: entry.model, ops: [] }; planned.push(group) }
        group.ops.push(upsert(entry.filter, { $set: entry.set, $setOnInsert: entry.setOnInsert }))
      }
      const summary = { events: eventEntries.length, receipts: receiptEntries.length, signals: signalEntries.length, ...context }
      if (!planned.length) return { ...summary, buffered: false, upserted: 0 }
      const envelopes = planned.flatMap(group => group.ops.map(op => orderWriteEnvelope(group.name, op.updateOne.filter, op.updateOne.update.$set, op.updateOne.update.$setOnInsert)))
      // Redis first: the drain worker turns these envelopes into Mongo writes.
      if (await bufferOrderWrites(envelopes)) {
        markPendingReceipts(receiptEntries)
        logEvent('info', 'order_writes_buffered', summary)
        // Exact upsert counts are only known once the worker writes Mongo.
        return { ...summary, buffered: true, upserted: signalEntries.length }
      }
      const written = await applyOrderWrites(planned)
      logEvent('info', 'order_writes_flushed', { ...summary, models: Object.keys(written) })
      const upserted = planned.filter(group => group.name !== 'OrderEvent' && group.name !== 'OrderReceipt').reduce((total, group) => total + (written[group.name]?.upserted || 0), 0)
      return { ...summary, buffered: false, upserted }
    },
  }
}
// Return the count used by the sync job's stored progress.
export async function writeSignalPage(provider, pageSignals, userId, setOnInsert = {}) {
  if (!pageSignals.length) return 0
  const writes = createOrderWriteBatch()
  for (const signal of pageSignals) writes.signal(provider, signal, userId, setOnInsert)
  const written = await writes.flush({ provider, connectionId: String(pageSignals[0].connectionId) })
  return written.upserted
}
