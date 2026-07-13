const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const notificationSchema = new mongoose.Schema({
  notificationId: {
    type: String,
    // Uniqueness enforced per-tenant via a partial compound index (below).
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true 
  },
  receiverRole: { 
    type: String, 
    enum: ['admin', 'staff', 'agent', 'borrower'],
    required: true 
  },
  senderId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  senderRole: { 
    type: String 
  },
  borrowerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Borrower'
  },
  loanApplicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LoanApplication'
  },
  notificationType: {
    type: String,
    enum: [
      'BORROWER_ALERT',
      'DUE_REMINDER',
      'LOAN_APPROVAL',
      'PAYMENT_UPDATE',
      'PAYMENT_RECEIVED',
      'OVERDUE_WARNING',
      'FOLLOWUP_REMINDER',
      'DOCUMENT_REQUEST',
      'ADMIN_ALERT',
      'NewLoanRequest',
      'ReviewAssigned',
      'PaymentVerification',
      'PaymentRejected',
      'NewMessage',
      'BorrowerReply',
      'AdminMessage',
      'OverdueAlert',
      'LoanApproved',
      'LoanRejected'
    ]
  },
  type: {
    type: String,
    enum: [
      'BORROWER_ALERT',
      'DUE_REMINDER',
      'LOAN_APPROVAL',
      'PAYMENT_UPDATE',
      'PAYMENT_RECEIVED',
      'OVERDUE_WARNING',
      'FOLLOWUP_REMINDER',
      'DOCUMENT_REQUEST',
      'ADMIN_ALERT',
      // Legacy types for compatibility
      'NewLoanRequest',
      'ReviewAssigned',
      'PaymentVerification',
      'PaymentRejected',
      'NewMessage',
      'BorrowerReply',
      'AdminMessage',
      'OverdueAlert',
      'LoanApproved',
      'LoanRejected'
    ],
    required: true
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  priority: {
    type: String,
    enum: ['NORMAL', 'IMPORTANT', 'URGENT', 'normal', 'important', 'urgent'],
    default: 'NORMAL'
  },
  status: {
    type: String,
    enum: ['READ', 'UNREAD'],
    default: 'UNREAD'
  },
  actionType: { type: String },
  dueAmount: { type: Number },
  relatedConversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
  metadata: { type: mongoose.Schema.Types.Mixed },
  isDeleted: { type: Boolean, default: false },
  relatedId: { type: mongoose.Schema.Types.ObjectId }, // Legacy support
  relatedModel: { type: String } // Legacy support
}, { timestamps: true });

// Pre-save hook to generate notificationId
notificationSchema.pre('save', function() {
  if (!this.notificationId) {
    this.notificationId = 'NOT-' + Math.random().toString(36).substr(2, 9).toUpperCase();
  }
  
  // Sync status and isRead
  if (this.status === 'READ') {
    this.isRead = true;
    if (!this.readAt) this.readAt = new Date();
  } else if (this.isRead) {
    this.status = 'READ';
    if (!this.readAt) this.readAt = new Date();
  }
});

notificationSchema.plugin(tenantPlugin);

// Tenant-scoped performance indexes (replace the previous non-tenant ones).
notificationSchema.index({ tenantId: 1, receiverId: 1, status: 1 });
notificationSchema.index({ tenantId: 1, createdAt: -1 });
// Tenant-scoped uniqueness for the optional business id.
notificationSchema.index(
  { tenantId: 1, notificationId: 1 },
  { unique: true, partialFilterExpression: { notificationId: { $type: 'string' } } }
);

module.exports = mongoose.model('Notification', notificationSchema);

