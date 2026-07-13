const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/**
 * UsageRecord
 * -----------
 * One row per metered event (API call, SMS, email, OCR, AML, credit, face,
 * storage, upload, document, export). Tenant-scoped. This data drives Billing
 * in a later milestone.
 */
const SERVICES = [
  'api', 'sms', 'email', 'ocr', 'aml', 'credit_bureau', 'facetec',
  'storage', 'image_upload', 'document', 'export',
];

const usageRecordSchema = new mongoose.Schema(
  {
    service: { type: String, enum: SERVICES, required: true },
    action: { type: String, default: '' }, // e.g. 'send', 'verify', 'lookup'
    provider: { type: String, default: '' }, // e.g. 'bulksms', 'datanamix', 'facetec'
    units: { type: Number, default: 1 }, // count, or MB for storage
    cost: { type: Number, default: 0 },
    currency: { type: String, default: 'ZAR' },
    status: { type: String, enum: ['success', 'failed', 'pending'], default: 'success' },
    metadata: { type: mongoose.Schema.Types.Mixed },
    occurredAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

usageRecordSchema.plugin(tenantPlugin);
usageRecordSchema.index({ tenantId: 1, service: 1, occurredAt: -1 });
usageRecordSchema.index({ tenantId: 1, occurredAt: -1 });

usageRecordSchema.statics.SERVICES = SERVICES;

module.exports = mongoose.model('UsageRecord', usageRecordSchema);
