import mongoose from 'mongoose'
const microsoftSignalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'MicrosoftConnection', required: true, index: true }, messageIdHash: { type: String, required: true }, threadIdHash: { type: String, required: true }, senderEmail: { type: String, default: null, lowercase: true, trim: true }, senderDomain: { type: String, default: null, lowercase: true, trim: true, index: true }, subjectSignal: { type: String, default: null, maxlength: 160 }, billingAmountMinor: { type: Number, default: null, min: 1, max: 1_000_000_000 }, billingCurrency: { type: String, default: null, enum: ['AUD', 'CAD', 'EUR', 'GBP', 'INR', 'JPY', 'USD'] }, billingCycle: { type: String, default: null, enum: ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] }, occurredAt: { type: Date, required: true, index: true },
  syncRunId: { type: String, default: null, select: false, index: true },
}, { timestamps: true })
microsoftSignalSchema.index({ userId: 1, connectionId: 1, messageIdHash: 1 }, { unique: true })
const MicrosoftSignal = mongoose.model('MicrosoftSignal', microsoftSignalSchema)
export default MicrosoftSignal
