const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const bureauReportArchiveSchema = new mongoose.Schema(
  {
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanApplication', required: true, index: true },
    borrowerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Borrower', required: true, index: true },
    enquiryId: { type: String, required: true },
    enquiryResultId: { type: String, required: true },
    bureauReference: { type: String, required: true },
    pdfPath: { type: String }, // Backwards compatibility / path
    reportType: { type: String, default: 'Consumer Credit Report' },
    generatedAt: { type: Date, default: Date.now },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    environmentType: { type: String, enum: ['SANDBOX', 'LIVE'], default: 'SANDBOX' },
    auditVersion: { type: String, default: '1.0' },
    
    // Patch fields
    pdfVersion: { type: Number, default: 1 },
    pdfHash: { type: String, required: true },
    imagekitFileId: { type: String, required: true },
    imagekitUrl: { type: String, required: true },
    fileSize: { type: Number },
    mimeType: { type: String, default: 'application/pdf' },
    storageProvider: { type: String, default: 'ImageKit' },
    isSandboxReport: { type: Boolean, default: true },
    
    // Audit logs
    downloadsLog: [{
      downloadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      downloadedAt: { type: Date, default: Date.now },
      ipAddress: String
    }],
    viewsLog: [{
      viewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      viewedAt: { type: Date, default: Date.now },
      ipAddress: String
    }],
    printsLog: [{
      printedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      printedAt: { type: Date, default: Date.now },
      ipAddress: String
    }]
  },
  { timestamps: true }
);

bureauReportArchiveSchema.plugin(tenantPlugin);

module.exports = mongoose.model('BureauReportArchive', bureauReportArchiveSchema);
