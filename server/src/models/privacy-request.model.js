import mongoose from 'mongoose'

const privacyRequestTypes = ['ACCESS', 'DELETE', 'CORRECT', 'OPT_OUT']
const privacyRequestStatuses = ['DRAFT', 'READY', 'SENT', 'COMPLETED', 'CANCELLED']

const privacyRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    serviceName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    requestType: {
      type: String,
      enum: privacyRequestTypes,
      required: true,
    },
    status: {
      type: String,
      enum: privacyRequestStatuses,
      default: 'DRAFT',
    },
    notes: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    statusUpdatedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        delete returnedObject._id
        delete returnedObject.__v
        delete returnedObject.userId
      },
    },
  },
)

privacyRequestSchema.index({ userId: 1, status: 1, createdAt: -1 })

const PrivacyRequest = mongoose.model('PrivacyRequest', privacyRequestSchema)

export { privacyRequestStatuses, privacyRequestTypes }
export default PrivacyRequest
