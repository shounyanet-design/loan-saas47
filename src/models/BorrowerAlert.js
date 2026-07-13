const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const borrowerAlertSchema = new mongoose.Schema({
  borrowerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Borrower',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  alertType: {
    type: String,
    enum: ['EMI_DUE', 'PAYMENT_VERIFIED', 'LOAN_APPROVED', 'OVERDUE', 'FOLLOW_UP', 'SYSTEM'],
    default: 'SYSTEM'
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Critical'],
    default: 'Low'
  },
  isRead: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

borrowerAlertSchema.plugin(tenantPlugin);

module.exports = mongoose.model('BorrowerAlert', borrowerAlertSchema);
