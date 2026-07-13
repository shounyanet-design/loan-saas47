const mongoose = require('mongoose');
const tenantPlugin = require('../../../tenancy/tenantPlugin');

const agreementOTPSchema = new mongoose.Schema(
  {
    borrowerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    loanApplicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LoanApplication',
      required: true,
    },
    otpCode: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index to automatically remove expired OTPs from the database if desired, 
// though we will also handle expiry programmatically.
agreementOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

agreementOTPSchema.plugin(tenantPlugin);

module.exports = mongoose.model('AgreementOTP', agreementOTPSchema);
