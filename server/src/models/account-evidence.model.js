import mongoose from 'mongoose'

const evidenceClasses = [
  'ACCOUNT_CREATED',
  'ACCOUNT_VERIFICATION',
  'WELCOME',
  'LOGIN_ALERT',
  'OTP',
  'PASSWORD_RESET',
  'SECURITY_ALERT',
  'SUBSCRIPTION',
  'PAYMENT',
  'ACCOUNT_DELETION',
  'OTHER',
]

const accountEvidenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },
    connectionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
      select: false,
    },
    connectionProvider: {
      type: String,
      enum: ['GOOGLE', 'MICROSOFT'],
      required: true,
      default: 'GOOGLE',
      select: false,
    },
    gmailSignalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GmailSignal',
      select: false,
    },
    microsoftSignalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MicrosoftSignal',
      select: false,
    },
    evidenceClass: {
      type: String,
      enum: evidenceClasses,
      required: true,
    },
    evidenceWeight: { type: Number, required: true, min: 0, max: 100 },
    ownershipSignal: { type: Boolean, required: true },
    reasonCode: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    sourceDomain: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 253,
    },
    occurredAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        delete returnedObject._id
        delete returnedObject.__v
        delete returnedObject.userId
        delete returnedObject.connectionId
        delete returnedObject.gmailSignalId
        delete returnedObject.microsoftSignalId
      },
    },
  },
)

accountEvidenceSchema.index({ userId: 1, gmailSignalId: 1 }, { unique: true, partialFilterExpression: { gmailSignalId: { $exists: true } } })
accountEvidenceSchema.index({ userId: 1, microsoftSignalId: 1 }, { unique: true, partialFilterExpression: { microsoftSignalId: { $exists: true } } })
accountEvidenceSchema.index({ accountId: 1, occurredAt: -1 })
accountEvidenceSchema.index({ userId: 1, evidenceClass: 1 })

const AccountEvidence = mongoose.model('AccountEvidence', accountEvidenceSchema)

export { evidenceClasses }
export default AccountEvidence
