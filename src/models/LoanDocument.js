const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const loanDocumentSchema = new mongoose.Schema({
  loanApplicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LoanApplication',
    required: true
  },
  documentType: {
    type: String,
    enum: ['ID Document', 'Payslip', 'Bank Statement', 'Proof Of Address'],
    required: true
  },
  fileUrl: {
    type: String,
    required: true
  },
  fileId: {
    type: String
  },
  fileName: {

    type: String
  },
  fileSize: {
    type: Number
  },
  status: {
    type: String,
    enum: ['Pending', 'Verified', 'Rejected'],
    default: 'Pending'
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

loanDocumentSchema.plugin(tenantPlugin);

module.exports = mongoose.model('LoanDocument', loanDocumentSchema);
