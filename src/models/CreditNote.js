const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/** CreditNote — issued against an invoice (full/partial credit). Tenant-scoped. */
const creditNoteSchema = new mongoose.Schema(
  {
    creditNoteNumber: { type: String, required: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'ZAR' },
    reason: { type: String, default: '' },
    issuedBy: { type: String },
  },
  { timestamps: true }
);

creditNoteSchema.plugin(tenantPlugin);
creditNoteSchema.index({ tenantId: 1, createdAt: -1 });
creditNoteSchema.index({ tenantId: 1, creditNoteNumber: 1 }, { unique: true });

module.exports = mongoose.model('CreditNote', creditNoteSchema);
