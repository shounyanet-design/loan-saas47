const mongoose = require('mongoose');

const loanProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  minAmount: { type: Number, default: 1000 },
  maxAmount: { type: Number, default: 100000 },
  minTenure: { type: Number, default: 3 },
  maxTenure: { type: Number, default: 24 },
  interestType: { type: String, enum: ['Flat Rate', 'Reducing Balance'], default: 'Reducing Balance' },
  defaultInterestRate: { type: Number, default: 12.5 },
  minInterestRate: { type: Number, default: 8.0 },
  maxInterestRate: { type: Number, default: 25.0 },
  processingFeeEnabled: { type: Boolean, default: true },
  insuranceEnabled: { type: Boolean, default: true },
  vatEnabled: { type: Boolean, default: true },
  autoAffordabilityEnabled: { type: Boolean, default: true },
  autoOcrEnabled: { type: Boolean, default: true },
  autoAmlEnabled: { type: Boolean, default: true },
  minIncomeRequired: { type: Number, default: 3000 },
  allowedEmploymentType: { type: String, default: 'Both' }
});

const defaultProducts = [
  { name: 'Personal Loan', code: 'PL-001', status: 'Active', minAmount: 1000, maxAmount: 50000, minTenure: 3, maxTenure: 24, interestType: 'Reducing Balance', defaultInterestRate: 12.5, minInterestRate: 8.0, maxInterestRate: 25.0, processingFeeEnabled: true, insuranceEnabled: true, vatEnabled: true, autoAffordabilityEnabled: true, autoOcrEnabled: true, autoAmlEnabled: true, minIncomeRequired: 5000, allowedEmploymentType: 'Both' },
  { name: 'Payday Loan', code: 'PD-002', status: 'Active', minAmount: 500, maxAmount: 5000, minTenure: 1, maxTenure: 3, interestType: 'Flat Rate', defaultInterestRate: 15.0, minInterestRate: 10.0, maxInterestRate: 30.0, processingFeeEnabled: true, insuranceEnabled: false, vatEnabled: true, autoAffordabilityEnabled: true, autoOcrEnabled: true, autoAmlEnabled: false, minIncomeRequired: 3000, allowedEmploymentType: 'Employed' },
  { name: 'Business Loan', code: 'BL-003', status: 'Active', minAmount: 10000, maxAmount: 250000, minTenure: 6, maxTenure: 60, interestType: 'Reducing Balance', defaultInterestRate: 10.5, minInterestRate: 7.0, maxInterestRate: 18.0, processingFeeEnabled: true, insuranceEnabled: true, vatEnabled: true, autoAffordabilityEnabled: false, autoOcrEnabled: false, autoAmlEnabled: true, minIncomeRequired: 10000, allowedEmploymentType: 'Self Employed' },
  { name: 'Debt Consolidation', code: 'DC-004', status: 'Active', minAmount: 5000, maxAmount: 150000, minTenure: 12, maxTenure: 48, interestType: 'Reducing Balance', defaultInterestRate: 11.5, minInterestRate: 8.0, maxInterestRate: 20.0, processingFeeEnabled: true, insuranceEnabled: true, vatEnabled: true, autoAffordabilityEnabled: true, autoOcrEnabled: true, autoAmlEnabled: true, minIncomeRequired: 8000, allowedEmploymentType: 'Both' },
  { name: 'Salary Advance', code: 'SA-005', status: 'Active', minAmount: 200, maxAmount: 3000, minTenure: 1, maxTenure: 1, interestType: 'Flat Rate', defaultInterestRate: 5.0, minInterestRate: 3.0, maxInterestRate: 10.0, processingFeeEnabled: false, insuranceEnabled: false, vatEnabled: true, autoAffordabilityEnabled: true, autoOcrEnabled: true, autoAmlEnabled: false, minIncomeRequired: 2000, allowedEmploymentType: 'Employed' }
];

const systemSettingsSchema = new mongoose.Schema({
  // Interest settings (legacy / system level)
  defaultInterestRate: { type: Number, default: 12.5 },
  minInterestRate: { type: Number, default: 8.0 },
  maxInterestRate: { type: Number, default: 25.0 },
  interestType: { type: String, enum: ['Reducing Balance', 'Flat Rate'], default: 'Reducing Balance' },

  // Processing fee (legacy / system level)
  processingFeeType: { type: String, enum: ['Fixed Amount', 'Percentage'], default: 'Fixed Amount' },
  processingFeeValue: { type: Number, default: 250 },
  autoApplyProcessingFee: { type: Boolean, default: true },

  // Repayment Governance (legacy / system level)
  gracePeriodDays: { type: Number, default: 3 },
  lateFeeAmount: { type: Number, default: 150 },
  allowGracePeriod: { type: Boolean, default: true },
  autoApplyLateFee: { type: Boolean, default: true },
  graceReminders: { type: Boolean, default: true },

  // Loan Configuration (legacy / system level)
  minimumLoanAmount: { type: Number, default: 1000 },
  maximumLoanAmount: { type: Number, default: 100000 },

  // Eligibility Settings (legacy / system level)
  minimumAge: { type: Number, default: 18 },
  maximumAge: { type: Number, default: 65 },
  minimumMonthlyIncome: { type: Number, default: 5000 },
  employmentType: { type: String, enum: ['Employed', 'Self Employed', 'Both'], default: 'Both' },
  eligibleMinimumPrincipal: { type: Number, default: 1000 },
  eligibleMaximumPrincipal: { type: Number, default: 50000 },
  allowedRepaymentDurations: { type: String, default: '3, 6, 12, 18, 24' },
  employmentCategories: { type: [String], default: ['Permanently Employed', 'Contract Worker', 'Self Employed', 'Pensioner', 'Government Employee'] },
  salaryFrequencies: { type: [String], default: ['Monthly', 'Weekly', 'Fortnightly'] },
  allowedLoanProducts: { type: [String], default: ['Personal Loan', 'Payday Loan', 'Business Loan', 'Debt Consolidation', 'Salary Advance'] },

  // Document verification rules (legacy / system level)
  idVerificationRequired: { type: Boolean, default: true },
  bankStatementReview: { type: Boolean, default: true },
  payslipVerification: { type: Boolean, default: true },
  proofOfAddressAudit: { type: Boolean, default: true },
  manualStaffDecision: { type: Boolean, default: true },
  creditBureauIntegration: { type: Boolean, default: false },

  // Validation
  enableAutoApprovalLogic: { type: Boolean, default: false },
  enableEligibilityEngine: { type: Boolean, default: true },
  enableAutoAssignment: { type: Boolean, default: true },

  // 1. LOAN PRODUCT CONFIGURATION
  loanProducts: { type: [loanProductSchema], default: defaultProducts },

  // 2. NCR FEE CONFIGURATION ENGINE
  initiationFeeType: { type: String, enum: ['Fixed Amount', 'Percentage'], default: 'Percentage' },
  initiationFeeValue: { type: Number, default: 10 }, // 10% initiation fee
  monthlyServiceFee: { type: Number, default: 60 },
  vatPercentage: { type: Number, default: 15 }, // 15% VAT in South Africa
  creditLifeInsuranceRate: { type: Number, default: 1.2 }, // 1.2% p.a.
  collectionFeeRate: { type: Number, default: 10 }, // 10% collection fee
  latePaymentPenalty: { type: Number, default: 150 },
  debitOrderRetryFee: { type: Number, default: 50 },
  legalCollectionThreshold: { type: Number, default: 500 },

  // 4. AFFORDABILITY ENGINE SETTINGS
  minDisposableIncome: { type: Number, default: 2000 },
  maxDtiPercentage: { type: Number, default: 40 }, // 40% DTI
  ncrBenchmarkThreshold: { type: Number, default: 15000 },
  minSalaryRequirement: { type: Number, default: 5000 },
  minEmploymentDuration: { type: Number, default: 6 }, // 6 months
  riskCategoryMatrix: { type: String, enum: ['Low Risk', 'Medium Risk', 'High Risk'], default: 'Medium Risk' },
  autoApproveIfEligible: { type: Boolean, default: false },
  affordabilityWarningThreshold: { type: Number, default: 35 },

  // 5. DOCUMENT COMPLIANCE SETTINGS
  idDocumentRequired: { type: Boolean, default: true },
  proofOfAddressRequired: { type: Boolean, default: true },
  ocrRequired: { type: Boolean, default: true },
  facialMatchRequired: { type: Boolean, default: true },
  amlRequired: { type: Boolean, default: true },
  hanisVerificationRequired: { type: Boolean, default: false },
  fraudDetectionRequired: { type: Boolean, default: true },
  minimumRequiredDocuments: { type: Number, default: 3 },

  // 6. BANK VERIFICATION SETTINGS
  avsEnabled: { type: Boolean, default: true },
  verificationProvider: { type: String, default: 'Datanamix' },
  verificationTimeout: { type: Number, default: 30 },
  retryAttempts: { type: Number, default: 3 },
  manualOverrideAllowed: { type: Boolean, default: true },
  fallbackVerificationMode: { type: String, enum: ['AVS Only', 'Manual Review'], default: 'Manual Review' },
  bankVerificationEnvironment: { type: String, enum: ['SANDBOX', 'LIVE'], default: 'SANDBOX' },
  bankAutoApprovalRulesEnabled: { type: Boolean, default: true },
  bankMismatchTolerance: { type: String, enum: ['Strict', 'Flexible'], default: 'Flexible' },
  bankWarningThresholds: { type: Number, default: 3 },
  bankPdfGenerationMode: { type: String, enum: ['JSON_AND_PDF', 'JSON_ONLY'], default: 'JSON_AND_PDF' },

  // Compliance Engine Settings
  amlAutoRejectEnabled: { type: Boolean, default: true },
  ofacStrictBlock: { type: Boolean, default: true },
  fatfCountryMonitoring: { type: Boolean, default: true },
  pepReviewThreshold: { type: Number, default: 70 },
  sandboxComplianceBypass: { type: Boolean, default: false },
  manualOverridePermission: { type: String, enum: ['Admin Only', 'Staff & Admin'], default: 'Admin Only' },

  // 7. WORKFLOW & STATUS ENGINE
  approvalRouting: { type: String, enum: ['Strict Admin Only', 'Reviewer Direct'], default: 'Strict Admin Only' },
  rejectionPermissions: { type: String, enum: ['Admin Only', 'Reviewer Allowed'], default: 'Admin Only' },
  escalationTriggers: { type: Boolean, default: true },
  testMode: { type: Boolean, default: true },

  // PDF Compliance Settings
  enableBureauPdfArchiving: { type: Boolean, default: true },
  allowPdfDownload: { type: Boolean, default: true },
  allowPdfPrint: { type: Boolean, default: true },
  requirePdfBeforeApproval: { type: Boolean, default: false },
  enableSandboxWatermark: { type: Boolean, default: true },
  enablePdfHashValidation: { type: Boolean, default: true },
  pdfRetentionPeriod: { type: Number, default: 60 },
  allowVersionHistory: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);
