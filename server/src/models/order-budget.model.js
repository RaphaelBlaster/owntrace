import mongoose from 'mongoose'
const schema = new mongoose.Schema({
  owner: { type: String, required: true }, day: { type: String, required: true },
  modelUnits: { type: Number, default: 0 }, metadata: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
})
schema.index({ owner: 1, day: 1 }, { unique: true })
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
export default mongoose.model('OrderBudget', schema)
