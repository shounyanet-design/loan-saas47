const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const reminderHistorySchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  type: { type: String, enum: ['Email', 'SMS', 'System'], default: 'System' },
  status: { type: String, enum: ['Sent', 'Failed'], default: 'Sent' },
  senderName: { type: String },
  message: { type: String }
});

const duePaymentSchema = new mongoose.Schema({
  borrowerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  borrowerName: { type: String },
  borrowerPhoto: { type: String },
  borrowerPhone: { type: String },
  borrowerEmail: { type: String },
  borrowerAddress: { type: String },

  loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'ActiveLoan', required: true },
  loanCode: { type: String, required: true },
  installmentNumber: { type: Number, required: true },
  loanAmount: { type: Number },
  remainingBalance: { type: Number },

  emiAmount: { type: Number, required: true },
  dueDate: { type: Date, required: true },

  overdueDays: { type: Number, default: 0 },
  penaltyAmount: { type: Number, default: 0 },
  totalDueAmount: { type: Number, required: true },

  dueStatus: { type: String, enum: ['Due Today', 'Overdue', 'Paid', 'Rescheduled', 'Cancelled', 'Recalled'], default: 'Due Today' },
  lateDayStatus: { type: String, enum: ['On Time', '1-7 Days Late', '8+ Days Late'], default: 'On Time' },

  reminderStatus: { type: String, enum: ['Pending Reminder', 'Reminder Sent', 'Escalated'], default: 'Pending Reminder' },
  reminderHistory: [reminderHistorySchema],

  lastReminderDate: { type: Date },
  nextReminderDate: { type: Date },

  notes: { type: String },
  isDeleted: { type: Boolean, default: false }
}, {
  timestamps: true
});

duePaymentSchema.plugin(tenantPlugin);

// One due payment record per installment (loanId is a globally-unique ObjectId).
duePaymentSchema.index({ loanId: 1, installmentNumber: 1 }, { unique: true });
// Powers overdue reporting / collections queries ("dueStatus + isDeleted").
duePaymentSchema.index({ tenantId: 1, dueStatus: 1, isDeleted: 1 });

module.exports = mongoose.model('DuePayment', duePaymentSchema);
