const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const reportSchema = new mongoose.Schema({
  reportTitle: { type: String, required: true },
  reportCode: { type: String, required: true },
  reportCategory: { 
    type: String, 
    enum: ['Loan Reports', 'Payment Reports', 'Collections Reports', 'Borrower Reports', 'Agent Commission Reports'],
    required: true
  },
  reportType: { type: String },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  generatedDate: { type: Date, default: Date.now },
  exportFormat: { type: String, enum: ['PDF', 'CSV', 'Excel'] },
  dateRange: { type: String },
  
  reportData: { type: mongoose.Schema.Types.Mixed },
  reportSummary: { type: String },
  
  totalCollections: { type: Number, default: 0 },
  totalLoans: { type: Number, default: 0 },
  activeBorrowers: { type: Number, default: 0 },
  overduePayments: { type: Number, default: 0 },
  commissions: { type: Number, default: 0 },

  fileUrl: { type: String },
  isDeleted: { type: Boolean, default: false }
}, { 
  timestamps: true 
});

reportSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Report', reportSchema);
