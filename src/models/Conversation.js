const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const conversationSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  participantRoles: [{ type: String }], // Explicit Roles list
  conversationType: { type: String, enum: ['Borrower', 'Agent', 'Admin', 'Internal Staff'], default: 'Admin' },
  
  participantType: { type: String, enum: ['direct', 'group', 'broadcast'], default: 'direct' }, // Backward-comp compatibility
  loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'ActiveLoan' },
  applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanApplication' },
  lastMessage: { type: String },
  lastMessageTime: { type: Date }, // Compatibility
  lastMessageAt: { type: Date }, // Explicit matching field
  unreadCounts: { type: Map, of: Number, default: {} },
  
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  isActive: { type: Boolean, default: true },
  
  isBroadcast: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

conversationSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Conversation', conversationSchema);
