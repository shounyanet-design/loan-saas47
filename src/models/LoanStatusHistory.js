const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const loanStatusHistorySchema = new mongoose.Schema({
  loanApplicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LoanApplication',
    required: true
  },
  status: {
    type: String,
    required: true
  },
  notes: {
    type: String
  },
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  changedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

loanStatusHistorySchema.plugin(tenantPlugin);

module.exports = mongoose.model('LoanStatusHistory', loanStatusHistorySchema);
