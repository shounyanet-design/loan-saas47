const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const loanBankingSchema = new mongoose.Schema({
  loanApplicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LoanApplication',
    required: true
  },
  bankName: {
    type: String,
    required: true
  },
  accountHolderName: {
    type: String,
    required: true
  },
  accountNumber: {
    type: String,
    required: true
  },
  branchCode: {
    type: String,
    required: true
  },
  requestedLoanAmount: {
    type: Number,
    required: true
  },
  requestedDuration: {
    type: Number, // in months
    required: true
  },
  repaymentDate: {
    type: Date
  }
}, { timestamps: true });

loanBankingSchema.plugin(tenantPlugin);

module.exports = mongoose.model('LoanBanking', loanBankingSchema);
