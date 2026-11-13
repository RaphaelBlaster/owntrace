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
    pushPending: { type: Boolean, default: false, select: false },
    // FULL lists the mailbox with messages.list; INCREMENTAL reads only the
    // messages added since historyStartId through users.history.list.
    syncMode: { type: String, enum: ['FULL', 'INCREMENTAL'], default: 'FULL' },
    historyStartId: { type: String, default: null, select: false },
    // Mailbox historyId this run will store on the connection when it completes.
    historyLatestId: { type: String, default: null, select: false },
    historyPageCount: { type: Number, default: 0, min: 0, select: false },
    metadataFailedCount: { type: Number, default: 0, min: 0, select: false },
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
        delete returnedObject.pushPending
        delete returnedObject.historyStartId
        delete returnedObject.historyLatestId
        delete returnedObject.historyPageCount
        delete returnedObject.metadataFailedCount
        return returnedObject
      },
    },
  },
)

const GmailSyncJob = mongoose.model('GmailSyncJob', gmailSyncJobSchema)

export default GmailSyncJob
