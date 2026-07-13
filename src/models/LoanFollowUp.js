const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const loanFollowUpSchema = new mongoose.Schema({
  loanId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'ActiveLoan', 
    required: true 
  },
  agentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Agent', 
    required: true 
  },
  borrowerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Borrower', 
    required: true 
  },
  type: { 
    type: String, 
    enum: ['Phone Call', 'WhatsApp', 'Field Visit', 'Promise To Pay', 'Escalation', 'No Response'], 
    required: true 
  },
  note: { 
    type: String, 
    required: true 
  },
  recoveryStatus: { 
    type: String, 
    enum: ['Normal', 'Promised', 'Warning', 'Critical'], 
    default: 'Normal' 
  },
  images: [{ 
    url: String, 
    fileId: String 
  }],
  location: {
    lat: Number,
    lng: Number,
    address: String
  },
  followUpDate: { 
    type: Date, 
    default: Date.now 
  }
}, {
  timestamps: true
});

loanFollowUpSchema.plugin(tenantPlugin);

module.exports = mongoose.model('LoanFollowUp', loanFollowUpSchema);
