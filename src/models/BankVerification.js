const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const bankVerificationSchema = new mongoose.Schema(
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
    bankName: {
      type: String,
      required: true
    },
    accountNumber: {
      type: String,
      required: true
    },
    branchCode: {
      type: String
    },
    matchIndicators: {
      idNumberMatch: {
        type: String,
        enum: ['Y', 'N', 'U'], // Yes, No, Unknown
        default: 'U'
      },
      nameMatch: {
        type: String,
        enum: ['Y', 'N', 'U'],
        default: 'U'
      },
      accountActive: {
        type: String,
        enum: ['Y', 'N', 'U'],
        default: 'U'
      },
      acceptsDebits: {
        type: String,
        enum: ['Y', 'N', 'U'],
        default: 'U'
      },
      acceptsCredits: {
        type: String,
        enum: ['Y', 'N', 'U'],
        default: 'U'
      }
    },
    rawVerificationResult: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    verifiedAt: {
      type: Date,
      default: Date.now,
      required: true
    },
    verificationSuccess: {
      type: Boolean,
      default: false,
      required: true
    }
  },
  {
    timestamps: true
  }
);

bankVerificationSchema.plugin(tenantPlugin);

module.exports = mongoose.model('BankVerification', bankVerificationSchema);
