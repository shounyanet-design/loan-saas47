const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const loanAssignmentSchema = new mongoose.Schema({
  loanApplicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LoanApplication',
    required: true
  },
  assignedAgentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedStaffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignmentType: {
    type: String,
    enum: ['Auto', 'Manual'],
    default: 'Manual'
  },
  assignedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

loanAssignmentSchema.plugin(tenantPlugin);

module.exports = mongoose.model('LoanAssignment', loanAssignmentSchema);
