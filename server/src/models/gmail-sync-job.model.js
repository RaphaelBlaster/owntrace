import mongoose from 'mongoose'

const gmailSyncJobSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    connectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GoogleConnection',
      required: true,
    },
    status: {
      type: String,
      enum: ['QUEUED', 'SCANNING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
      default: 'QUEUED',
    },
    processedCount: { type: Number, default: 0, min: 0 },
    storedCount: { type: Number, default: 0, min: 0 },
    estimatedTotal: { type: Number, default: null, min: 0 },
    nextPageToken: { type: String, default: null, select: false },
    runId: { type: String, default: null, select: false },
    leaseId: { type: String, default: null, select: false },
    lastErrorCode: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
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
        delete returnedObject.connectionId
        delete returnedObject.nextPageToken
        delete returnedObject.runId
        delete returnedObject.leaseId
        return returnedObject
      },
    },
  },
)

const GmailSyncJob = mongoose.model('GmailSyncJob', gmailSyncJobSchema)

export default GmailSyncJob
