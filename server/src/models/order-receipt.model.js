import mongoose from 'mongoose'
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  connectionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  provider: { type: String, enum: ['gmail', 'outlook'], required: true },
  messageIdHash: { type: String, required: true }, fingerprint: { type: String, required: true },
  outcome: { type: String, enum: ['skipped', 'review', 'order', 'subscription'], required: true },
  policyVersion: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true })
schema.index({ userId: 1, provider: 1, connectionId: 1, messageIdHash: 1 }, { unique: true })
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
export default mongoose.model('OrderReceipt', schema)
