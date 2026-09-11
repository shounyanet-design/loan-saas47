const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const collectionAttemptSchema = new mongoose.Schema({
  borrowerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Borrower', required: true },
  loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'ActiveLoan', required: true },
  activeLoanId: { type: mongoose.Schema.Types.ObjectId, ref: 'ActiveLoan' },
  repaymentScheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'RepaymentSchedule', required: true },
  installmentIdentifier: { type: String }, // e.g. EMI number
  emiNumber: { type: Number },
  
  collectionMethod: { type: String, enum: ['DEBICHECK', 'PAYFAST_CARD', 'MANUAL'], required: true },
  provider: { type: String, enum: ['REALPAY', 'PAYFAST', 'OFFLINE'], required: true },
  
  attemptNumber: { type: Number, default: 1 },
  
  status: { 
    type: String, 
    enum: ['PENDING', 'SUBMITTED', 'PROCESSING', 'TRACKING', 'SUCCESSFUL', 'UNSUCCESSFUL', 'SUCCESS', 'FAILED', 'CANCELLED', 'REVERSED'], 
    default: 'PENDING' 
  },
  
  requestedAmount: { type: Number, required: true },
  amount: { type: Number },
  currency: { type: String, default: 'ZAR' },
  
  providerReference: { type: String }, // Mandate ID or PayFast token used
  idempotencyKey: { type: String, unique: true, sparse: true }, // Webhook processing lock
  
  failureCode: { type: String },
  failureReason: { type: String },
  
  fallbackStatus: { 
    type: String, 
    enum: ['NOT_ELIGIBLE', 'ELIGIBLE', 'TRIGGERED', 'EXHAUSTED', 'NOT_CONFIGURED', 'UNAVAILABLE'], 
    default: 'NOT_ELIGIBLE' 
  },
  
  originalAttemptId: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionAttempt' },
  fallbackAttemptId: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionAttempt' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  
  submittedAt: { type: Date },
  trackingAt: { type: Date },
  unsuccessfulAt: { type: Date },
  successfulAt: { type: Date },
  completedAt: { type: Date }
}, {
  timestamps: true
});

collectionAttemptSchema.plugin(tenantPlugin);

// Prevent double processing in the webhook by enforcing idempotency keys
collectionAttemptSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } });

// Common lookup for finding active attempts for a given schedule
collectionAttemptSchema.index({ tenantId: 1, repaymentScheduleId: 1, status: 1 });

module.exports = mongoose.model('CollectionAttempt', collectionAttemptSchema);
