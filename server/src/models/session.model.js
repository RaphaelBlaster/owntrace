import mongoose from 'mongoose'

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenIdHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
)

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
sessionSchema.index({ userId: 1, createdAt: -1 })

const Session = mongoose.model('Session', sessionSchema)

export default Session
