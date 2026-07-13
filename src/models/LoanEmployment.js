const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const loanEmploymentSchema = new mongoose.Schema({
  loanApplicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LoanApplication',
    required: true
  },
  employmentStatus: {
    type: String,
    enum: ['Employed', 'Self-Employed', 'Business Owner'],
    required: true
  },
  employerName: {
    type: String,
    required: function() { return this.employmentStatus === 'Employed'; }
  },
  monthlyIncome: {
    type: Number,
    required: true
  },
  workAddress: {
    type: String,
    required: true
  },
  employmentDuration: {
    type: String,
    required: true
  }
}, { timestamps: true });

loanEmploymentSchema.plugin(tenantPlugin);

module.exports = mongoose.model('LoanEmployment', loanEmploymentSchema);
