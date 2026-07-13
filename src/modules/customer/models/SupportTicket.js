const mongoose = require('mongoose');
const tenantPlugin = require('../../../tenancy/tenantPlugin');

/** Threaded support ticket. Tenant-scoped (isolated per customer). */
const messageSchema = new mongoose.Schema({
  authorType: { type: String, enum: ['customer', 'agent', 'system'], default: 'customer' },
  authorEmail: { type: String },
  body: { type: String, required: true },
  at: { type: Date, default: () => new Date() },
}, { _id: false });

const supportTicketSchema = new mongoose.Schema(
  {
    ticketNumber: { type: String, required: true },
    subject: { type: String, required: true },
    category: { type: String, enum: ['general', 'billing', 'technical', 'account', 'api', 'feature_request'], default: 'general' },
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    status: { type: String, enum: ['open', 'pending', 'resolved', 'closed'], default: 'open' },
    messages: { type: [messageSchema], default: [] },
    createdByEmail: { type: String },
    assignedTo: { type: String }, // platform agent email
    lastReplyAt: { type: Date },
  },
  { timestamps: true }
);

supportTicketSchema.plugin(tenantPlugin);
supportTicketSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
supportTicketSchema.index({ tenantId: 1, ticketNumber: 1 }, { unique: true });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
