import mongoose from 'mongoose'
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  enabled: { type: Boolean, default: false }, daily: { type: Boolean, default: false },
  version: { type: Number, default: 0 }, acceptedAt: { type: Date, default: null },
  nextDailyAt: { type: Date, default: null },
}, { timestamps: true })
schema.index({ enabled: 1, daily: 1, nextDailyAt: 1 })
export default mongoose.model('OrderPreference', schema)
