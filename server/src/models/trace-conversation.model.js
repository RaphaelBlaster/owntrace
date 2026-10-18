import mongoose from 'mongoose'

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true, maxlength: 16000 },
  sources: { type: [mongoose.Schema.Types.Mixed], default: [] },
  actions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  createdAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['pending', 'completed', 'failed', 'cancelled'], default: 'completed' },
  grounding: { type: [mongoose.Schema.Types.Mixed], default: [] },
})
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: 'New conversation', maxlength: 80 },
  messages: { type: [messageSchema], default: [] },
  leaseId: { type: String, default: null, select: false },
  leaseUntil: { type: Date, default: null, select: false },
}, { timestamps: true, toJSON: { transform(_document, value) {
  value.id = value._id.toString()
  delete value._id; delete value.__v; delete value.userId; delete value.leaseId; delete value.leaseUntil
} } })
schema.index({ userId: 1, updatedAt: -1 })
export default mongoose.model('TraceConversation', schema)
