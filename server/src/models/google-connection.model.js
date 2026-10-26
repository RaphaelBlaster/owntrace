import mongoose from 'mongoose'

const googleConnectionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    googleAccountId: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    scopes: { type: [String], default: [] },
    encryptedAccessToken: { type: String, required: true, select: false },
    encryptedRefreshToken: { type: String, required: true, select: false },
    tokenExpiresAt: { type: Date, required: true },
    refreshTokenExpiresAt: { type: Date, default: null },
    pushStatus: { type: String, enum: ['DISABLED', 'PENDING', 'ACTIVE', 'ERROR'], default: 'DISABLED' },
    pushExpiresAt: { type: Date, default: null },
    pushErrorCode: { type: String, default: null },
    connectedAt: { type: Date, default: Date.now },
    lastSyncAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['CONNECTED', 'NEEDS_RECONNECT', 'SYNCING', 'DISCONNECTING', 'ERROR'],
      default: 'CONNECTED',
    },
    lastErrorCode: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        delete returnedObject._id
        delete returnedObject.__v
        delete returnedObject.userId
        delete returnedObject.googleAccountId
        delete returnedObject.encryptedAccessToken
        delete returnedObject.encryptedRefreshToken
        delete returnedObject.pushErrorCode
        return returnedObject
      },
    },
  },
)

googleConnectionSchema.index({ googleAccountId: 1 }, { unique: true })

const GoogleConnection = mongoose.model('GoogleConnection', googleConnectionSchema)

export default GoogleConnection
