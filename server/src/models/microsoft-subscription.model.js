import mongoose from 'mongoose'
import { billingCycles, subscriptionConfidenceLevels, supportedCurrencies } from './subscription.model.js'

const microsoftSubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    serviceKey: { type: String, required: true, trim: true, lowercase: true, maxlength: 253 },
    serviceName: { type: String, required: true, trim: true, maxlength: 120 },
    primaryDomain: { type: String, required: true, trim: true, lowercase: true, maxlength: 253 },
    amountMinor: { type: Number, default: null, min: 1, max: 1_000_000_000 },
    currency: { type: String, default: null, enum: supportedCurrencies },
    billingCycle: { type: String, enum: billingCycles, default: 'UNKNOWN' },
    confidenceLevel: { type: String, enum: subscriptionConfidenceLevels, required: true },
    confidenceScore: { type: Number, required: true, min: 0, max: 100 },
    basis: { type: [{ type: String, enum: ['PAYMENT', 'SUBSCRIPTION'] }], default: [] },
    evidenceCount: { type: Number, required: true, min: 1 },
    evidenceSignalIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MicrosoftSignal' }],
      default: [],
      select: false,
      validate: { validator: (value) => value.length <= 100, message: 'Subscription evidence references are capped at 100.' },
    },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    lastPaymentAt: { type: Date, default: null },
    nextRenewalAt: { type: Date, default: null },
    renewalIsEstimated: { type: Boolean, default: false },
    source: { type: String, enum: ['MICROSOFT_METADATA'], default: 'MICROSOFT_METADATA' },
  },
  { timestamps: true, toJSON: { transform(_document, returnedObject) { returnedObject.id = returnedObject._id.toString(); delete returnedObject._id; delete returnedObject.__v; delete returnedObject.userId; delete returnedObject.evidenceSignalIds } } },
)

microsoftSubscriptionSchema.index({ userId: 1, serviceKey: 1 }, { unique: true })
microsoftSubscriptionSchema.index({ userId: 1, lastSeenAt: -1 })
microsoftSubscriptionSchema.index({ userId: 1, confidenceScore: -1 })

export default mongoose.model('MicrosoftSubscription', microsoftSubscriptionSchema)
