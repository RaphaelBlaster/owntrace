import mongoose from 'mongoose'

const MAX_BREACH_REPORT_BREACHES = 500

const breachReportSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ['XPOSED_OR_NOT'],
      required: true,
      default: 'XPOSED_OR_NOT',
    },
    breaches: {
      type: [{
        _id: false,
        name: { type: String, required: true, trim: true, maxlength: 160 },
      }],
      default: [],
      validate: {
        message: `Breach reports can contain at most ${MAX_BREACH_REPORT_BREACHES} names.`,
        validator: (value) => value.length <= MAX_BREACH_REPORT_BREACHES,
      },
    },
    lastCheckedAt: { type: Date, default: null },
    nextCheckAt: { type: Date, default: null },
    checkingStartedAt: { type: Date, default: null, select: false },
    checkingToken: { type: String, default: null, select: false, maxlength: 80 },
    lastErrorCode: { type: String, default: null, maxlength: 80 },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        delete returnedObject._id
        delete returnedObject.__v
        delete returnedObject.userId
        delete returnedObject.checkingStartedAt
        delete returnedObject.checkingToken
      },
    },
  },
)

breachReportSchema.index({ userId: 1, nextCheckAt: 1 })

const BreachReport = mongoose.model('BreachReport', breachReportSchema)

export default BreachReport
export { MAX_BREACH_REPORT_BREACHES }
