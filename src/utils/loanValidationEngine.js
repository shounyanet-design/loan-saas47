const { getValidationRules } = require('../services/validationRules.service');
const LoanDocument = require('../models/LoanDocument');

/**
 * Helper to calculate age from DOB
 */
const calculateAge = (dob) => {
  if (!dob) return null;
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

/**
 * Helper to parse employment duration into number of months
 */
const parseEmploymentMonths = (val) => {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  const strVal = String(val).toLowerCase();
  const match = strVal.match(/\d+/);
  if (!match) return 0;
  let months = parseInt(match[0], 10);
  if (strVal.includes('year') || strVal.includes('yr')) {
    months = months * 12;
  }
  return months;
};

/**
 * Validates loan application data against configured system rules
 * @param {Object} data - Contains form data from Borrower/Staff/Admin
 * @param {Object} rules - Standardized validation rules object
 * @returns {Object} { isValid: boolean, errors: Object }
 */
const validateLoanApplicationData = (data, rules) => {
  const errors = {};

  // 1. Validate Age
  let age = data.age;
  if (age === undefined || age === null) {
    const dob = data.dob || data.dateOfBirth;
    if (dob) {
      age = calculateAge(dob);
    }
  }
  if (age !== undefined && age !== null) {
    if (age < rules.minAge) {
      errors.age = `Minimum eligible age is ${rules.minAge} years.`;
    } else if (age > rules.maxAge) {
      errors.age = `Maximum eligible age is ${rules.maxAge} years.`;
    }
  } else if (data.dob || data.dateOfBirth) {
    // If DOB is provided but invalid
    errors.age = "Please enter a valid Date of Birth.";
  }

  // 2. Validate Monthly Income
  const income = Number(data.monthlyIncome || data.income || data.grossIncome);
  if (!isNaN(income)) {
    if (income < rules.minimumIncome) {
      errors.monthlyIncome = `Minimum monthly income must be R${rules.minimumIncome}.`;
    }
  }

  // 3. Validate Employment Duration
  const empMonths = parseEmploymentMonths(data.employmentDuration || data.employmentMonths || data.monthsAtEmployer);
  if (data.employmentDuration || data.employmentMonths || data.monthsAtEmployer) {
    if (empMonths < rules.minimumEmploymentMonths) {
      errors.employmentDuration = `Minimum employment duration is ${rules.minimumEmploymentMonths} months.`;
    }
  }

  // 4. Validate Loan Amount
  const amount = Number(data.requestedLoanAmount || data.loanAmount || data.requestedAmount || data.amount);
  if (!isNaN(amount) && amount > 0) {
    if (amount < rules.minimumPrincipal || amount > rules.maximumPrincipal) {
      errors.loanAmount = `Allowed loan amount range is R${rules.minimumPrincipal} - R${rules.maximumPrincipal}.`;
    }
  }

  // 5. Validate Loan Duration
  const duration = Number(data.requestedDuration || data.duration || data.tenure);
  if (!isNaN(duration) && duration > 0) {
    if (!rules.allowedDurations.includes(duration)) {
      errors.loanDuration = "Selected repayment duration is not permitted.";
    }
  }

  // 6. Validate Employment Type
  const empType = data.employmentStatus || data.employmentType;
  if (empType) {
    const sysEmpType = rules.employmentType || 'Both';
    if (sysEmpType === 'Employed') {
      if (['Self-Employed', 'Business Owner', 'Self Employed'].includes(empType)) {
        errors.employmentType = "Employment type does not qualify.";
      }
    } else if (sysEmpType === 'Self Employed') {
      if (['Employed', 'Permanently Employed', 'Contract Worker'].includes(empType)) {
        errors.employmentType = "Employment type does not qualify.";
      }
    }
  }

  // 7. Validate Documents (Check if array provided in data payload)
  if (Array.isArray(data.documents)) {
    const docTypes = data.documents.map(d => typeof d === 'string' ? d : (d.documentType || d.type));
    const missingDocs = [];
    if (rules.requiredKYC.idDocument && !docTypes.some(t => ['ID Document', 'idDocument'].includes(t))) {
      missingDocs.push("ID Document");
    }
    if (rules.requiredKYC.payslip && !docTypes.some(t => ['Payslip', 'payslip'].includes(t))) {
      missingDocs.push("Payslip");
    }
    if (rules.requiredKYC.proofOfAddress && !docTypes.some(t => ['Proof Of Address', 'proofOfAddress'].includes(t))) {
      missingDocs.push("Proof Of Address");
    }

    if (missingDocs.length > 0) {
      errors.documents = "Required KYC documents are missing.";
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

/**
 * Validates an active loan application in the database, including checking uploaded documents
 * @param {string} loanApplicationId - MongoDB ObjectId for LoanApplication
 * @param {Object} formData - Any incoming updates to merge with DB state
 * @returns {Object} { isValid: boolean, errors: Object }
 */
const validateDBApplication = async (loanApplicationId, formData = {}) => {
  const LoanApplication = require('../models/LoanApplication');
  const LoanEmployment = require('../models/LoanEmployment');
  const LoanBanking = require('../models/LoanBanking');

  const rules = await getValidationRules();

  // Load existing data from DB
  const app = await LoanApplication.findById(loanApplicationId);
  if (!app) return { isValid: false, errors: { general: 'Application not found' } };

  const emp = await LoanEmployment.findOne({ loanApplicationId });
  const banking = await LoanBanking.findOne({ loanApplicationId });
  const docs = await LoanDocument.find({ loanApplicationId });

  // Merge database state with input updates
  const combinedData = {
    dob: formData.dateOfBirth || formData.dob || app.dateOfBirth,
    monthlyIncome: formData.monthlyIncome || emp?.monthlyIncome,
    employmentDuration: formData.employmentDuration || emp?.employmentDuration,
    requestedLoanAmount: formData.requestedLoanAmount || formData.requestedAmount || banking?.requestedLoanAmount || app.requestedAmount,
    requestedDuration: formData.requestedDuration || formData.requestedDuration || banking?.requestedDuration || app.requestedDuration,
    employmentStatus: formData.employmentStatus || formData.employmentType || emp?.employmentStatus,
    documents: docs
  };

  return validateLoanApplicationData(combinedData, rules);
};

module.exports = {
  validateLoanApplicationData,
  validateDBApplication
};
