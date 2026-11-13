import mongoose from 'mongoose'
const microsoftConnectionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  microsoftAccountId: { type: String, required: true, unique: true }, email: { type: String, required: true, lowercase: true, trim: true }, scopes: { type: [String], default: [] },
  encryptedAccessToken: { type: String, required: true, select: false }, encryptedRefreshToken: { type: String, required: true, select: false }, tokenExpiresAt: { type: Date, required: true }, connectedAt: { type: Date, default: Date.now }, lastSyncAt: { type: Date, default: null },
  graphSubscriptionId: { type: String, default: null, select: false, index: true }, graphSubscriptionExpiresAt: { type: Date, default: null }, graphClientStateHash: { type: String, default: null, select: false }, pushStatus: { type: String, enum: ['DISABLED', 'PENDING', 'ACTIVE', 'ERROR'], default: 'DISABLED' }, pushErrorCode: { type: String, default: null },
  status: { type: String, enum: ['CONNECTED', 'NEEDS_RECONNECT', 'SYNCING', 'ERROR', 'DISCONNECTING'], default: 'CONNECTED' }, lastErrorCode: { type: String, default: null },
}, { timestamps: true, toJSON: { transform(_doc, value) { value.id = value._id.toString(); delete value._id; delete value.__v; delete value.userId; delete value.microsoftAccountId; delete value.encryptedAccessToken; delete value.encryptedRefreshToken; delete value.graphSubscriptionId; delete value.graphClientStateHash; delete value.pushErrorCode } } })
const MicrosoftConnection = mongoose.model('MicrosoftConnection', microsoftConnectionSchema)
export default MicrosoftConnection
