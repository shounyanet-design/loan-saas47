const SystemSettings = require('../../models/SystemSettings');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');

// Utility to get or seed default settings
const getOrInitSettings = async () => {
  let settings = await SystemSettings.findOne();
  if (!settings) {
    settings = await SystemSettings.create({}); // Creates with schema defaults
  }
  return settings;
};

/**
 * @desc    Get current system settings
 * @route   GET /api/admin/settings
 * @access  Private/Admin
 */
const getSettings = asyncHandler(async (req, res) => {
  const settings = await getOrInitSettings();
  sendSuccess(res, 'System settings fetched', settings);
});

/**
 * @desc    Update general settings
 * @route   PUT /api/admin/settings/general
 * @access  Private/Admin
 */
const updateGeneralSettings = asyncHandler(async (req, res) => {
  const {
    defaultInterestRate,
    minInterestRate,
    maxInterestRate,
    interestType,
    processingFeeType,
    processingFeeValue,
    autoApplyProcessingFee,
    gracePeriodDays,
    lateFeeAmount,
    allowGracePeriod,
    autoApplyLateFee,
    graceReminders,
    minimumLoanAmount,
    maximumLoanAmount
  } = req.body;

  if (processingFeeValue !== undefined) {
    const pFee = Number(processingFeeValue);
    if (isNaN(pFee) || pFee < 0 || pFee > 1050) {
      return sendError(res, 'NCR Compliance Error: Processing fee cannot exceed statutory cap of R1,050.00 or be negative', 400);
    }
  }

  let settings = await getOrInitSettings();

  settings.defaultInterestRate = defaultInterestRate;
  settings.minInterestRate = minInterestRate;
  settings.maxInterestRate = maxInterestRate;
  settings.interestType = interestType;
  settings.processingFeeType = processingFeeType;
  settings.processingFeeValue = processingFeeValue;
  settings.autoApplyProcessingFee = autoApplyProcessingFee;
  settings.gracePeriodDays = gracePeriodDays;
  settings.lateFeeAmount = lateFeeAmount;
  settings.allowGracePeriod = allowGracePeriod;
  settings.autoApplyLateFee = autoApplyLateFee;
  settings.graceReminders = graceReminders;
  settings.minimumLoanAmount = minimumLoanAmount;
  settings.maximumLoanAmount = maximumLoanAmount;

  await settings.save();
  sendSuccess(res, 'General settings updated successfully', settings);
});

/**
 * @desc    Update eligibility rules
 * @route   PUT /api/admin/settings/eligibility
 * @access  Private/Admin
 */
const updateEligibilityRules = asyncHandler(async (req, res) => {
  const {
    minimumAge,
    minimumMonthlyIncome,
    employmentType,
    eligibleMinimumPrincipal,
    eligibleMaximumPrincipal,
    allowedRepaymentDurations
  } = req.body;

  let settings = await getOrInitSettings();

  settings.minimumAge = minimumAge;
  settings.minimumMonthlyIncome = minimumMonthlyIncome;
  settings.employmentType = employmentType;
  settings.eligibleMinimumPrincipal = eligibleMinimumPrincipal;
  settings.eligibleMaximumPrincipal = eligibleMaximumPrincipal;
  settings.allowedRepaymentDurations = allowedRepaymentDurations;

  await settings.save();
  sendSuccess(res, 'Eligibility rules updated successfully', settings);
});

/**
 * @desc    Update documentation and verification rules
 * @route   PUT /api/admin/settings/document-rules
 * @access  Private/Admin
 */
const updateDocumentRules = asyncHandler(async (req, res) => {
  const {
    idVerificationRequired,
    bankStatementReview,
    payslipVerification,
    proofOfAddressAudit,
    manualStaffDecision,
    creditBureauIntegration,
    enableAutoApprovalLogic
  } = req.body;

  let settings = await getOrInitSettings();

  settings.idVerificationRequired = idVerificationRequired;
  settings.bankStatementReview = bankStatementReview;
  settings.payslipVerification = payslipVerification;
  settings.proofOfAddressAudit = proofOfAddressAudit;
  settings.manualStaffDecision = manualStaffDecision;
  settings.creditBureauIntegration = creditBureauIntegration;
  settings.enableAutoApprovalLogic = enableAutoApprovalLogic;

  await settings.save();
  sendSuccess(res, 'Verification rules updated successfully', settings);
});

/**
 * @desc    Reset settings to system defaults
 * @route   POST /api/admin/settings/reset
 * @access  Private/Admin
 */
const resetSettings = asyncHandler(async (req, res) => {
  await SystemSettings.deleteMany({});
  const freshSettings = await SystemSettings.create({}); // seed default blank object, will auto-populate via defaults
  sendSuccess(res, 'System settings reset to default successfully', freshSettings);
});

/**
 * @desc    Update system settings in bulk
 * @route   PUT /api/admin/settings/bulk
 * @access  Private/Admin
 */
const updateBulkSettings = asyncHandler(async (req, res) => {
  let settings = await getOrInitSettings();

  // Regulatory compliance checks for South African NCR statutory limits
  if (req.body.initiationFeeBaseFee !== undefined) {
    const base = Number(req.body.initiationFeeBaseFee);
    if (isNaN(base) || base < 0 || base > 165) {
      return sendError(res, 'NCR Compliance Error: Initiation fee base cannot exceed R165.00', 400);
    }
  }

  if (req.body.initiationFeeThreshold !== undefined) {
    const threshold = Number(req.body.initiationFeeThreshold);
    if (isNaN(threshold) || threshold < 0) {
      return sendError(res, 'NCR Compliance Error: Initiation fee threshold cannot be negative', 400);
    }
  }

  if (req.body.initiationFeeExcessPercentage !== undefined) {
    const excess = Number(req.body.initiationFeeExcessPercentage);
    if (isNaN(excess) || excess < 0 || excess > 10) {
      return sendError(res, 'NCR Compliance Error: Excess percentage above threshold cannot exceed 10%', 400);
    }
  }

  if (req.body.initiationFeeCap !== undefined) {
    const cap = Number(req.body.initiationFeeCap);
    if (isNaN(cap) || cap < 0 || cap > 1050) {
      return sendError(res, 'NCR Compliance Error: Maximum initiation fee cannot exceed statutory cap of R1,050.00', 400);
    }
  }

  if (req.body.monthlyServiceFee !== undefined) {
    const fee = Number(req.body.monthlyServiceFee);
    if (isNaN(fee) || fee < 0 || fee > 60) {
      return sendError(res, 'NCR Compliance Error: Monthly service fee cannot exceed statutory cap of R60.00/month', 400);
    }
  }

  Object.keys(req.body).forEach(key => {
    // If the key is a valid field on the document, update it
    if (key !== '_id' && key !== '__v') {
      settings[key] = req.body[key];
    }
  });

  await settings.save();
  sendSuccess(res, 'System settings updated successfully', settings);
});

/**
 * @desc    Calculate live logic preview without saving
 * @route   POST /api/admin/settings/live-preview
 * @access  Private/Admin
 */
const calculateLivePreview = asyncHandler(async (req, res) => {
  const temp = req.body; // Contains unsaved client settings
  
  // Calculate dynamic Monthly Repayment based on principal = 10000 over 12 months using South African NCR fees
  const P = 10000;
  const N = 12;
  const rate = Number(temp.defaultInterestRate || 12.5);
  
  const { calculateLoanFinances } = require('../../services/loanFinancialCalculator');
  const finances = calculateLoanFinances({
    amount: P,
    duration: N,
    interestRate: rate,
    interestType: temp.interestType || 'Reducing Balance',
    settings: temp,
    selectedProduct: {
      processingFeeEnabled: true,
      insuranceEnabled: true,
      vatEnabled: true,
      interestType: temp.interestType || 'Reducing Balance'
    }
  });

  // Formulate response matching frontend expectations
  const response = {
    monthlyRepayment: finances.monthlyInstallmentAmount,
    minPrincipal: temp.eligibleMinimumPrincipal || 1000,
    maxPrincipal: temp.eligibleMaximumPrincipal || 50000,
    baseInterest: `${rate}%`,
    processingFee: temp.processingFeeType === 'Percentage' 
      ? `${temp.processingFeeValue || 0}%` 
      : `R ${temp.processingFeeValue || 0}`,
    penaltyGrace: `${temp.gracePeriodDays || 0} Days`,
    logicSummary: {
      interestBasis: temp.interestType || 'Reducing Balance',
      feeFrequency: 'Once per approved loan',
      penaltyBasis: temp.autoApplyLateFee ? 'Automated Overdue Run' : 'Manual Verification Trigger',
      reviewFlow: temp.enableAutoApprovalLogic ? 'Instant Automated Desk' : 'Manual Verification Gate'
    },
    // NCR parameters
    initiationFee: finances.initiationFeeAmount,
    monthlyServiceFee: finances.monthlyServiceFee,
    insuranceFee: finances.insuranceAmount,
    vatOnFees: finances.vatAmount,
    totalRepayment: finances.totalRepaymentAmount,
    pureInterestAmount: finances.pureInterestAmount,
    totalCostOfCredit: finances.totalCostOfCreditAmount,
    financialSnapshot: finances
  };

  sendSuccess(res, 'Live preview calculated', response);
});

/**
 * @desc    Get current tenant's company legal profile
 * @route   GET /api/admin/settings/company-profile
 * @access  Private/Admin
 */
const getCompanyProfile = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  if (!tenantId) {
    return sendError(res, 'Tenant context missing on user profile', 400);
  }
  const Tenant = require('../../models/Tenant');
  const tenantContext = require('../../tenancy/tenantContext');
  const tenant = await tenantContext.runAsSystem(() => Tenant.findById(tenantId).lean());
  if (!tenant) {
    return sendError(res, 'Tenant not found', 404);
  }
  sendSuccess(res, 'Tenant company profile fetched', tenant.companyProfile || {});
});

/**
 * @desc    Update current tenant's company legal profile
 * @route   PUT /api/admin/settings/company-profile
 * @access  Private/Admin
 */
const updateCompanyProfile = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  if (!tenantId) {
    return sendError(res, 'Tenant context missing on user profile', 400);
  }
  const Tenant = require('../../models/Tenant');
  const tenantContext = require('../../tenancy/tenantContext');

  const profileData = req.body;
  const tenant = await tenantContext.runAsSystem(() => Tenant.findById(tenantId));
  if (!tenant) {
    return sendError(res, 'Tenant not found', 404);
  }

  tenant.companyProfile = tenant.companyProfile || {};

  const fields = [
    'legalName', 'tradingName', 'cipcRegistrationNumber', 'ncrRegistrationNumber',
    'vatNumber', 'telephone', 'email', 'website', 'logoUrl'
  ];
  fields.forEach(f => {
    if (profileData[f] !== undefined) tenant.companyProfile[f] = profileData[f];
  });

  if (profileData.registeredAddress) {
    tenant.companyProfile.registeredAddress = tenant.companyProfile.registeredAddress || {};
    const addrFields = ['addressLine1', 'addressLine2', 'city', 'province', 'postalCode', 'country'];
    addrFields.forEach(f => {
      if (profileData.registeredAddress[f] !== undefined) {
        tenant.companyProfile.registeredAddress[f] = profileData.registeredAddress[f];
      }
    });
  }

  if (profileData.authorizedSignatory) {
    tenant.companyProfile.authorizedSignatory = tenant.companyProfile.authorizedSignatory || {};
    const sigFields = ['fullName', 'designation'];
    sigFields.forEach(f => {
      if (profileData.authorizedSignatory[f] !== undefined) {
        tenant.companyProfile.authorizedSignatory[f] = profileData.authorizedSignatory[f];
      }
    });
  }

  // Map back to root fields to prevent duplicates and maintain compatibility
  if (tenant.companyProfile.legalName) tenant.companyName = tenant.companyProfile.legalName;
  if (tenant.companyProfile.email) tenant.email = tenant.companyProfile.email;
  if (tenant.companyProfile.telephone) tenant.phone = tenant.companyProfile.telephone;
  if (tenant.companyProfile.logoUrl) tenant.brandLogo = tenant.companyProfile.logoUrl;
  if (tenant.companyProfile.registeredAddress?.country) tenant.country = tenant.companyProfile.registeredAddress.country;

  tenant.markModified('companyProfile');
  await tenantContext.runAsSystem(() => tenant.save());

  sendSuccess(res, 'Tenant company profile updated successfully', tenant.companyProfile);
});

module.exports = {
  getSettings,
  updateGeneralSettings,
  updateEligibilityRules,
  updateDocumentRules,
  updateBulkSettings,
  resetSettings,
  calculateLivePreview,
  getCompanyProfile,
  updateCompanyProfile
};
