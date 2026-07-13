const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const agentClientActivitySchema = new mongoose.Schema({
  borrowerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Borrower',
    required: true
  },
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['FollowUp', 'Assistance', 'PaymentReceived', 'EMIOverdue', 'BorrowerAssigned'],
    required: true
  },
  category: {
    type: String, // e.g., 'Loan Inquiry', 'Send Reminder', 'WhatsApp Reminder'
    required: true
  },
  notes: {
    type: String
  },
  nextFollowUpDate: {
    type: Date
  },
  communicationMessage: {
    type: String
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId // Can link to Payment, ActiveLoan etc.
  }
}, {
  timestamps: true
});

agentClientActivitySchema.plugin(tenantPlugin);

module.exports = mongoose.model('AgentClientActivity', agentClientActivitySchema);
