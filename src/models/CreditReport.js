const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const creditReportSchema = new mongoose.Schema(
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
    creditScore: {
      type: Number,
      required: true
    },
    scoreBand: {
      type: String,
      enum: ['POOR', 'FAIR', 'GOOD', 'VERY_GOOD', 'EXCELLENT', 'UNKNOWN'],
      default: 'UNKNOWN'
    },
    riskCategory: {
      type: String,
      enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'N/A'],
      default: 'N/A'
    },
    hasDefaults: {
      type: Boolean,
      default: false
    },
    defaultCount: {
      type: Number,
      default: 0
    },
    defaultAmount: {
      type: Number,
      default: 0
    },
    hasJudgements: {
      type: Boolean,
      default: false
    },
    judgementCount: {
      type: Number,
      default: 0
    },
    judgementAmount: {
      type: Number,
      default: 0
    },
    totalOutstandingDebt: {
      type: Number,
      default: 0
    },
    monthlyDebtServiceObligation: {
      type: Number,
      default: 0
    },
    bureauRawData: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    retrievedAt: {
      type: Date,
      default: Date.now,
      required: true
    },
    consentAccepted: {
      type: Boolean,
      required: true,
      default: false
    }
  },
  {
    timestamps: true
  }
);

creditReportSchema.plugin(tenantPlugin);

module.exports = mongoose.model('CreditReport', creditReportSchema);
