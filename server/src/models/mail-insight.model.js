import mongoose from 'mongoose'

export const mailCategories = ['jobs', 'orders', 'subscriptions', 'security', 'finance', 'travel', 'social', 'marketing', 'spam', 'personal', 'other']
export const MAIL_ENRICHMENT_VERSION = 2
const insightSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  provider: { type: String, enum: ['gmail', 'outlook'], required: true },
  connectionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  messageHash: { type: String, required: true },
  threadHash: { type: String, default: null },
  fingerprint: { type: String, required: true },
  runId: { type: String, required: true, index: true },
  category: { type: String, enum: mailCategories, required: true },
  senderDomain: String,
  title: { type: String, maxlength: 120 },
  status: { type: String, maxlength: 60 },
  summary: { type: String, maxlength: 300 },
  evidence: { type: String, maxlength: 240 },
  companyName: { type: String, maxlength: 120 },
  companyDomain: { type: String, maxlength: 253 },
  companyEvidence: { type: String, maxlength: 240 },
  roleName: { type: String, maxlength: 120 },
  roleEvidence: { type: String, maxlength: 240 },
  applicationReference: { type: String, maxlength: 80 },
  referenceType: { type: String, enum: ['application', 'requisition', null], default: null },
  referenceEvidence: { type: String, maxlength: 240 },
  eventKind: { type: String, enum: ['application', 'opportunity', 'other'], default: 'other' },
  enrichmentVersion: { type: Number, default: MAIL_ENRICHMENT_VERSION },
  occurredAt: { type: Date, required: true },
  importance: { type: Number, min: 1, max: 3, default: 1 },
  actionRequired: { type: Boolean, default: false },
  analyzedBy: { type: String, enum: ['jev', 'mercury', 'local'], required: true },
}, { timestamps: true })
insightSchema.index({ userId: 1, provider: 1, connectionId: 1, messageHash: 1 }, { unique: true })
export const MailInsight = mongoose.model('MailInsight', insightSchema)

const analysisSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  enabled: { type: Boolean, default: false },
  version: { type: Number, default: 1 },
  acceptedAt: Date,
  provider: { type: String, enum: ['gmail', 'outlook'] },
  connectionId: mongoose.Schema.Types.ObjectId,
  runId: String,
  previousRunId: { type: String, default: null },
  status: { type: String, enum: ['IDLE', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'], default: 'IDLE' },
  processed: { type: Number, default: 0 },
  limit: { type: Number, default: 250 },
  cursor: { type: String, default: null, select: false },
  until: Date,
  leaseId: { type: String, default: null, select: false },
  leaseUntil: Date,
  pushPending: { type: Boolean, default: false },
  lastErrorCode: { type: String, default: null },
  enrichmentStatus: { type: String, enum: ['IDLE', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'], default: 'IDLE' },
  enrichmentProcessed: { type: Number, default: 0 },
  enrichmentCursor: { type: String, default: null, select: false },
  enrichmentLeaseId: { type: String, default: null, select: false },
  enrichmentLeaseUntil: Date,
  enrichmentErrorCode: { type: String, default: null },
}, { timestamps: true })
export const MailAnalysis = mongoose.model('MailAnalysis', analysisSchema)
