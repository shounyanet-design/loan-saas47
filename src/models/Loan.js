const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const loanSchema = new mongoose.Schema(
  {
    borrowerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Borrower',
      required: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LoanApplication',
      required: true,
    },
    loanAmount: {
      type: Number,
      required: true,
    },
    remainingBalance: {
      type: Number,
      required: true,
    },
    EMIAmount: {
      type: Number,
      required: true,
    },
    repaymentSchedule: [
      {
        dueDate: Date,
        amount: Number,
        status: {
          type: String,
          enum: ['pending', 'paid', 'overdue'],
          default: 'pending',
        },
      },
    ],
    penalties: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['active', 'closed', 'defaulted'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

loanSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Loan', loanSchema);
