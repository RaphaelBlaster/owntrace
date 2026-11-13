import mongoose from 'mongoose'

const accountActionTypes = [
  'REVIEW_ACCOUNT',
  'SECURE_ACCOUNT',
  'CONSIDER_DELETION',
  'REVIEW_SIGN_IN',
]
const accountActionStatuses = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED']

const accountActionSchema = new mongoose.Schema(
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
    type: { type: String, enum: accountActionTypes, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 360 },
    reason: { type: String, required: true, trim: true, maxlength: 280 },
    priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], required: true },
    priorityRank: { type: Number, enum: [1, 2, 3], required: true, select: false },
    status: { type: String, enum: accountActionStatuses, default: 'OPEN' },
    statusUpdatedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    lastEvaluatedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        returnedObject.id = returnedObject._id.toString()
        returnedObject.accountId = returnedObject.accountId.toString()
        delete returnedObject._id
        delete returnedObject.__v
        delete returnedObject.priorityRank
        delete returnedObject.userId
      },
    },
  },
)

accountActionSchema.index({ userId: 1, accountId: 1, type: 1 }, { unique: true })
accountActionSchema.index({ userId: 1, status: 1, priority: 1 })
accountActionSchema.index({ accountId: 1, status: 1 })

const AccountAction = mongoose.model('AccountAction', accountActionSchema)

export { accountActionStatuses, accountActionTypes }
export default AccountAction
