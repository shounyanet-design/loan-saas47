const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const verificationLogSchema = new mongoose.Schema(
  {
    borrowerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Borrower',
      required: true,
      index: true
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LoanApplication',
      index: true
    },
    verificationType: {
      type: String,
      enum: ['IDV_PHOTO', 'FACETEC_LIVENESS', 'BANK_AHV', 'CREDIT_REPORT', 'PHONE_CARRIER', 'AML_PEP', 'KYC_PROFILE_PHOTO', 'KYC_OVERRIDE', 'BUREAU_PROFILE_VERIFICATION', 'BUREAU_OVERRIDE', 'PHONE_VERIFICATION', 'PHONE_VERIFICATION_FAILED', 'BANK_VERIFICATION', 'BANK_VERIFICATION_FAILED', 'CREDIT_REPORT_SEARCH', 'CREDIT_REPORT_OVERRIDE', 'CREDIT_REPORT_RESULT', 'CREDIT_REPORT_RESULT_FAILED', 'CONSUMER_CREDIT_REPORT_RESULT', 'CONSUMER_CREDIT_REPORT_RESULT_FAILED', 'AML_SCREENING', 'AML_SCREENING_FAILED', 'CREDIT_SEARCH_EXECUTION', 'CREDIT_REPORT_FETCH', 'CREDIT_RERUN', 'CREDIT_RESET', 'HASH_INVALIDATION', 'WORKFLOW_ESCALATION', 'MANUAL_REVIEW_TRIGGER'],
      required: true
    },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED', 'ERROR'],
      default: 'PENDING',
      required: true
    },
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    riskSeverity: {
      type: String
    },
    workflowRoute: {
      type: String
    },
    requestPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    responsePayload: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    errorMessage: {
      type: String
    },
    ipAddress: {
      type: String
    },
    attempts: {
      type: Number,
      default: 1
    }
  },
  {
    timestamps: true
  }
);

verificationLogSchema.plugin(tenantPlugin);

// Tenant-prefixed compound index for verification lookups.
verificationLogSchema.index({ tenantId: 1, borrowerId: 1, verificationType: 1, createdAt: -1 });

module.exports = mongoose.model('VerificationLog', verificationLogSchema);
