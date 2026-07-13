const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const smsLogSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    index: true
  },
  message: {
    type: String,
    required: true
  },
  provider: {
    type: String,
    default: 'BulkSMS',
    required: true
  },
  status: {
    type: String,
    enum: ['SENT', 'FAILED', 'TEST_MODE', 'RETRYING'],
    required: true,
    index: true
  },
  requestPayload: {
    type: mongoose.Schema.Types.Mixed
  },
  responsePayload: {
    type: mongoose.Schema.Types.Mixed
  },
  errorMessage: {
    type: String
  },
  batchId: {
    type: String,
    index: true
  },
  messageId: {
    type: String,
    index: true
  }
}, {
  timestamps: true
});

smsLogSchema.plugin(tenantPlugin);

module.exports = mongoose.model('SmsLog', smsLogSchema);
