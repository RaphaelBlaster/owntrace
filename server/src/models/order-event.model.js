import mongoose from 'mongoose'
export const orderStatuses = ['placed', 'confirmed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'refunded', 'unknown']
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  connectionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  provider: { type: String, enum: ['gmail', 'outlook'], required: true },
  messageIdHash: { type: String, required: true, select: false },
  fingerprint: { type: String, required: true, select: false },
  merchantName: { type: String, required: true, maxlength: 80 },
  merchantDomain: { type: String, required: true, maxlength: 253 },
  status: { type: String, enum: orderStatuses, required: true },
  orderReference: { type: String, default: null, maxlength: 80 },
  amountMinor: { type: Number, default: null, min: 0, max: 1_000_000_000, validate: value => value === null || Number.isSafeInteger(value) },
  currency: { type: String, default: null, enum: ['AUD', 'CAD', 'EUR', 'GBP', 'INR', 'JPY', 'USD'] },
  expectedDelivery: { type: String, default: null },
  summary: { type: String, required: true, maxlength: 240 },
  evidence: { type: mongoose.Schema.Types.Mixed, default: {} },
  occurredAt: { type: Date, required: true },
  policyVersion: { type: Number, required: true },
}, { timestamps: true })
schema.index({ userId: 1, provider: 1, connectionId: 1, messageIdHash: 1 }, { unique: true })
schema.index({ userId: 1, occurredAt: -1, _id: -1 })
schema.index({ userId: 1, merchantDomain: 1, orderReference: 1, occurredAt: 1 })
export default mongoose.model('OrderEvent', schema)
