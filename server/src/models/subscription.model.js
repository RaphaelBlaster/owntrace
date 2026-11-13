import mongoose from 'mongoose'

const billingCycles = ['UNKNOWN', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']
const subscriptionConfidenceLevels = ['POSSIBLE', 'LIKELY', 'CONFIRMED']
const supportedCurrencies = ['AUD', 'CAD', 'EUR', 'GBP', 'INR', 'JPY', 'USD']

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    serviceKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 253,
    },
    serviceName: { type: String, required: true, trim: true, maxlength: 120 },
    primaryDomain: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 253,
    },
    amountMinor: { type: Number, default: null, min: 1, max: 1_000_000_000 },
    currency: { type: String, default: null, enum: supportedCurrencies },
    billingCycle: { type: String, enum: billingCycles, default: 'UNKNOWN' },
    confidenceLevel: {
      type: String,
      enum: subscriptionConfidenceLevels,
      required: true,
    },
    confidenceScore: { type: Number, required: true, min: 0, max: 100 },
    basis: {
      type: [{ type: String, enum: ['PAYMENT', 'SUBSCRIPTION'] }],
      default: [],
    },
    evidenceCount: { type: Number, required: true, min: 1 },
    evidenceSignalIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GmailSignal' }],
      default: [],
      select: false,
      validate: {
        message: 'Subscription evidence references are capped at 100.',
        validator: (value) => value.length <= 100,
      },
    },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    lastPaymentAt: { type: Date, default: null },
    nextRenewalAt: { type: Date, default: null },
    renewalIsEstimated: { type: Boolean, default: false },
    source: { type: String, enum: ['GMAIL_METADATA'], default: 'GMAIL_METADATA' },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        delete returnedObject._id
        delete returnedObject.__v
        delete returnedObject.userId
        delete returnedObject.evidenceSignalIds
      },
    },
  },
)

subscriptionSchema.index({ userId: 1, serviceKey: 1 }, { unique: true })
subscriptionSchema.index({ userId: 1, lastSeenAt: -1 })
subscriptionSchema.index({ userId: 1, confidenceScore: -1 })

const Subscription = mongoose.model('Subscription', subscriptionSchema)

export { billingCycles, subscriptionConfidenceLevels, supportedCurrencies }
export default Subscription
