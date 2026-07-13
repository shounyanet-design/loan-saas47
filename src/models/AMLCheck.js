const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const amlCheckSchema = new mongoose.Schema(
  {
    borrowerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Borrower',
      required: true,
      index: true
    },
    pepStatusDetected: {
      type: Boolean,
      default: false,
      required: true
    },
    sanctionStatusDetected: {
      type: Boolean,
      default: false,
      required: true
    },
    crimeRecordDetected: {
      type: Boolean,
      default: false,
      required: true
    },
    riskScore: {
      type: Number,
      default: 0 // 0 to 100 representing risk severity
    },
    matchDetails: [
      {
        listName: String, // e.g., OFAC, EU Sanctions, Interpol
        matchedName: String,
        matchConfidence: Number,
        details: mongoose.Schema.Types.Mixed
      }
    ],
    screeningRawResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    screeningDate: {
      type: Date,
      default: Date.now,
      required: true
    },
    complianceOutcome: {
      type: String,
      enum: ['PASSED', 'REFERRED', 'FAILED'],
      default: 'PASSED',
      required: true
    },
    notes: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

amlCheckSchema.plugin(tenantPlugin);

module.exports = mongoose.model('AMLCheck', amlCheckSchema);
