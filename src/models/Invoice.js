const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/** Embedded invoice line item (covers the InvoiceItem responsibility). */
const invoiceItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  sku: String,
  quantity: { type: Number, default: 1 },
  unitPrice: { type: Number, default: 0 },
  lineTotal: { type: Number, default: 0 },
  metadata: { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

/**
 * Invoice — billing document. Tenant-scoped. `type` distinguishes a
 * subscription invoice from a marketplace invoice (one model, no duplication).
 */
const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true },
    type: { type: String, enum: ['marketplace', 'subscription', 'adjustment'], default: 'marketplace' },
    items: { type: [invoiceItemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    currency: { type: String, default: 'ZAR' },
    status: {
      type: String,
      enum: ['draft', 'pending', 'paid', 'failed', 'cancelled', 'refunded', 'overdue'],
      default: 'draft',
    },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceOrder' },
    couponCode: { type: String },
    dueDate: { type: Date },
    issuedAt: { type: Date },
    paidAt: { type: Date },
    notes: { type: String },
  },
  { timestamps: true }
);

invoiceSchema.plugin(tenantPlugin);
invoiceSchema.index({ tenantId: 1, createdAt: -1 });
invoiceSchema.index({ tenantId: 1, status: 1 });
invoiceSchema.index({ tenantId: 1, invoiceNumber: 1 }, { unique: true });

module.exports = mongoose.model('Invoice', invoiceSchema);
