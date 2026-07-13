const mongoose = require('mongoose');

const systemSettingSchema = new mongoose.Schema(
  {
    interestRate: {
      type: Number,
      required: true,
      default: 0,
    },
    processingFee: {
      type: Number,
      required: true,
      default: 0,
    },
    gracePeriod: {
      type: Number, // in days
      required: true,
      default: 0,
    },
    lateFee: {
      type: Number,
      required: true,
      default: 0,
    },
    eligibilityRules: {
      minIncome: Number,
      minAge: Number,
      maxLoans: Number,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('SystemSetting', systemSettingSchema);
