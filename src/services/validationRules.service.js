const SystemSettings = require('../models/SystemSettings');

/**
 * Fetch all active validation rules from the Admin Settings collection.
 * Converts DB schema values into a standardized rules object for backend and frontend engines.
 */
const getValidationRules = async () => {
  let settings = await SystemSettings.findOne();
  if (!settings) {
    // Seed default settings if not exists
    settings = await SystemSettings.create({});
  }

  // Parse allowed repayment durations (stored as comma-separated string)
  let allowedDurations = [3, 6, 12, 18, 24];
  if (settings.allowedRepaymentDurations) {
    if (typeof settings.allowedRepaymentDurations === 'string') {
      allowedDurations = settings.allowedRepaymentDurations
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n));
    } else if (Array.isArray(settings.allowedRepaymentDurations)) {
      allowedDurations = settings.allowedRepaymentDurations.map(n => Number(n)).filter(n => !isNaN(n));
    }
  }

  return {
    minAge: settings.minimumAge ?? 18,
    maxAge: settings.maximumAge ?? 65,
    minimumIncome: settings.minimumMonthlyIncome ?? 5000,
    minimumEmploymentMonths: settings.minEmploymentDuration ?? 6,
    minimumPrincipal: settings.eligibleMinimumPrincipal ?? 1000,
    maximumPrincipal: settings.eligibleMaximumPrincipal ?? 50000,
    allowedDurations: allowedDurations,
    minDTI: settings.maxDtiPercentage ?? 40,
    warningDTI: settings.affordabilityWarningThreshold ?? 35,
    mandatoryDocuments: settings.minimumRequiredDocuments ?? 3,
    employmentTypes: settings.employmentCategories ?? ['Permanently Employed', 'Contract Worker', 'Self Employed', 'Pensioner', 'Government Employee'],
    salaryFrequencies: settings.salaryFrequencies ?? ['Monthly', 'Weekly', 'Fortnightly'],
    requiredKYC: {
      idDocument: settings.idDocumentRequired ?? true,
      payslip: settings.payslipVerification ?? true,
      proofOfAddress: settings.proofOfAddressRequired ?? true
    }
  };
};

module.exports = {
  getValidationRules
};
