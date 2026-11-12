import OrderEvent from '../models/order-event.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import GoogleConnection from '../models/google-connection.model.js'
import AppError from '../utils/app-error.js'
import mongoose from 'mongoose'

export function orderCard(event) {
  return {
    id: String(event._id), type: 'order', merchant: { name: event.merchantName, domain: event.merchantDomain, logoKey: event.merchantDomain },
    status: event.status, orderReference: event.orderReference, amountMinor: event.amountMinor, currency: event.currency,
    expectedDelivery: event.expectedDelivery, summary: event.summary, occurredAt: event.occurredAt,
    source: { provider: event.provider, connectionId: String(event.connectionId), evidenceId: String(event._id), kind: 'EMAIL_METADATA' },
    evidence: event.evidence || {}, inferred: true,
  }
}
async function sourceFilter(userId) {
  const [gmail, outlook] = await Promise.all([GoogleConnection.findOne({ userId }).select('_id'), MicrosoftConnection.findOne({ userId }).select('_id')])
  return { userId, $or: [...(gmail ? [{ provider: 'gmail', connectionId: gmail._id }] : []), ...(outlook ? [{ provider: 'outlook', connectionId: outlook._id }] : []), { _id: null }] }
}
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Bounded, escaped, case-insensitive merchant/item lookup. Every whitespace token must match one
// of the saved metadata fields (merchant name, sender domain or the derived item summary).
export function orderSearchFilter(search) {
  if (search === undefined || search === null || search === '') return {}
  if (typeof search !== 'string' || search.length > 80) throw new AppError('Order search must be 80 characters or fewer.', 400, 'INVALID_ORDER_QUERY')
  const tokens = search.trim().split(/\s+/).filter(Boolean).slice(0, 8)
  if (!tokens.length) return {}
  return { $and: tokens.map(token => { const pattern = new RegExp(escapeRegex(token), 'i'); return { $or: [{ merchantName: pattern }, { merchantDomain: pattern }, { summary: pattern }] } }) }
}
export async function listOrderCards(userId, { page = 1, limit = 12, provider, status, search } = {}) {
  const filter = { ...await sourceFilter(userId), ...(provider ? { provider } : {}), ...(status ? { status } : {}), ...orderSearchFilter(search) }
  const [events, total] = await Promise.all([OrderEvent.find(filter).sort({ occurredAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), OrderEvent.countDocuments(filter)])
  return { orders: events.map(orderCard), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } }
}
export async function orderDetails(userId, id) {
  if (!mongoose.isObjectIdOrHexString(id)) throw new AppError('Order evidence not found.', 404, 'ORDER_NOT_FOUND')
  const event = await OrderEvent.findOne({ ...await sourceFilter(userId), _id: id }).lean()
  if (!event) throw new AppError('Order evidence not found.', 404, 'ORDER_NOT_FOUND')
  // Group only exact merchant + explicit reference matches; preserve every mailbox's provenance.
  const timeline = event.orderReference ? await OrderEvent.find({ ...await sourceFilter(userId), merchantDomain: event.merchantDomain, orderReference: event.orderReference }).sort({ occurredAt: 1, _id: 1 }).limit(100).lean() : [event]
  return { order: orderCard(event), timeline: timeline.map(orderCard), timelineLimit: 100 }
}
