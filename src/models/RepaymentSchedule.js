const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const repaymentScheduleSchema = new mongoose.Schema({
  loanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ActiveLoan',
    required: true
  },
  borrowerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Borrower',
    required: true
  },
  emiNumber: {
    type: Number,
    required: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Paid', 'Partial', 'Overdue', 'Late Paid', 'Disputed'],
    default: 'Pending'
  },
  paidAt: {
    type: Date,
    default: null
  },
  lateDays: {
    type: Number,
    default: 0
  },
  penaltyAmount: {
    type: Number,
    default: 0
  },
  amountPaid: {
    type: Number,
    default: 0
  },
  penaltyWaived: {
    type: Boolean,
    default: false
  },
  penaltyWaivedAt: {
    type: Date,
    default: null
  },
  penaltyWaivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

repaymentScheduleSchema.plugin(tenantPlugin);

// Index for faster queries. loanId is a globally-unique ObjectId so the
// {loanId, emiNumber} unique constraint is already tenant-safe. The remaining
// lookups are tenant-prefixed because every query is tenant-scoped.
repaymentScheduleSchema.index({ loanId: 1, emiNumber: 1 }, { unique: true });
repaymentScheduleSchema.index({ tenantId: 1, borrowerId: 1 });
// Powers the daily EMI cron ("status + dueDate range").
repaymentScheduleSchema.index({ tenantId: 1, status: 1, dueDate: 1 });

module.exports = mongoose.model('RepaymentSchedule', repaymentScheduleSchema);
