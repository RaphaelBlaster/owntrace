import mongoose from 'mongoose'
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  provider: { type: String, enum: ['gmail', 'outlook'], required: true },
  connectionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  mode: { type: String, enum: ['initial', 'daily', 'on_demand'], required: true },
  status: { type: String, enum: ['QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'], default: 'QUEUED' },
  runId: { type: String, required: true, select: false },
  leaseId: { type: String, default: null, select: false },
  leaseUntil: { type: Date, default: null, select: false },
  cursor: { type: String, default: null, select: false, maxlength: 8192 },
  since: { type: Date, required: true }, until: { type: Date, required: true },
  filterDomain: { type: String, default: null, maxlength: 253 },
  checkpointAt: { type: Date, default: null },
  limit: { type: Number, required: true }, processed: { type: Number, default: 0 },
  examined: { type: Number, default: 0 }, stored: { type: Number, default: 0 },
  reviewed: { type: Number, default: 0 }, skipped: { type: Number, default: 0 },
  lastErrorCode: { type: String, default: null },
  lastOnDemandAt: { type: Date, default: null },
}, { timestamps: true })
schema.index({ userId: 1, provider: 1 }, { unique: true })
schema.index({ status: 1, leaseUntil: 1, updatedAt: 1 })
export default mongoose.model('OrderScan', schema)
