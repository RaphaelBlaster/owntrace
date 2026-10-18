import mongoose from 'mongoose'

const gmailSignalSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    connectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GoogleConnection',
      required: true,
      index: true,
    },
    messageIdHash: { type: String, required: true },
    threadIdHash: { type: String, required: true },
    senderEmail: { type: String, default: null, lowercase: true, trim: true },
    senderDomain: { type: String, default: null, lowercase: true, trim: true, index: true },
    subjectSignal: { type: String, default: null, maxlength: 160 },
    billingAmountMinor: { type: Number, default: null, min: 1, max: 1_000_000_000 },
    billingCurrency: {
      type: String,
      default: null,
      enum: ['AUD', 'CAD', 'EUR', 'GBP', 'INR', 'JPY', 'USD'],
    },
    billingCycle: {
      type: String,
      default: null,
      enum: ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'],
    },
    occurredAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
)

gmailSignalSchema.index(
  { userId: 1, connectionId: 1, messageIdHash: 1 },
  { unique: true },
)

const GmailSignal = mongoose.model('GmailSignal', gmailSignalSchema)

export default GmailSignal
