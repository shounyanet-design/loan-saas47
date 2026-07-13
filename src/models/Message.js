const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderRole: { type: String },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional for backwards compatibility
  receiverRole: { type: String },
  
  messageType: { 
    type: String, 
    enum: ['text', 'operational_update', 'reminder', 'escalation', 'compliance_notice'],
    default: 'text'
  },
  messageText: { type: String }, // Compatibility
  message: { type: String }, // Main content requested
  
  attachments: [{ type: String }], // Explicit support for files array
  attachmentUrl: { type: String }, // Compatibility
  attachment: { type: String }, // Explicit field requested
  attachmentName: { type: String }, // Explicit field requested
  
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Requested tracking array
  isRead: { type: Boolean, default: false }, // Compatibility
  
  delivered: { type: Boolean, default: false }, // Requested status
  isDelivered: { type: Boolean, default: false }, // Compatibility
  
  sentAt: { type: Date, default: Date.now },
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

messageSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Message', messageSchema);
