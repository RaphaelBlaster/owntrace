import OrderScan from '../models/order-scan.model.js'
import OrderEvent from '../models/order-event.model.js'
import OrderReceipt from '../models/order-receipt.model.js'
import { drainBufferedOrderWrites } from './order-write-buffer.service.js'
const active = new Map()
export function registerOrderWork(key, entry) { active.set(key, entry) }
export function releaseOrderWork(key) { active.delete(key) }
export async function cancelOrderWork(userId, provider) {
  const filter = { userId, ...(provider ? { provider } : {}) }
  await OrderScan.updateMany({ ...filter, status: { $in: ['QUEUED', 'RUNNING', 'PAUSED', 'FAILED'] } }, { $set: { status: 'CANCELLED', leaseId: null, leaseUntil: null, cursor: null } })
  const entries = [...active.values()].filter(entry => String(entry.userId) === String(userId) && (!provider || provider === entry.provider))
  entries.forEach(entry => entry.controller.abort())
  await Promise.allSettled(entries.map(entry => entry.done))
}
export async function removeOrderSource(userId, provider, connectionId) {
  await cancelOrderWork(userId, provider)
  const filter = { userId, provider, ...(connectionId ? { connectionId } : {}) }
  // Buffered writes are flushed first so nothing lands after the delete.
  await drainBufferedOrderWrites()
  await Promise.all([OrderScan.deleteMany(filter), OrderReceipt.deleteMany(filter), OrderEvent.deleteMany(filter)])
}
