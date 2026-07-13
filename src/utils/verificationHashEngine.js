const crypto = require('crypto');

/**
 * Deterministically generates a verification hash using application and borrower details.
 * 
 * Inputs used:
 * - borrowerId
 * - idNumber
 * - phoneNumber
 * - loanAmount (requestedAmount)
 * - basicSalary (from affordabilityOutcome or payload)
 * - allowances (from affordabilityOutcome or payload)
 * - otherIncome (from affordabilityOutcome or payload)
 * - expenses (totalExpenses from affordabilityOutcome or payload)
 * - monthlyInstallment (estimatedMonthlyEMI)
 * - applicationProduct (loanType)
 * - employmentType (borrower's employmentStatus)
 * 
 * @param {Object} app - The LoanApplication document/object
 * @param {Object} borrower - The Borrower document/object
 * @returns {string} SHA-256 hash string
 */
const generateVerificationHash = (app, borrower) => {
  if (!app) return '';

  const borrowerId = app.borrowerId || '';
  const idNumber = app.idNumber || borrower?.idNumber || '';
  const phoneNumber = app.phoneNumber || borrower?.phoneNumber || '';
  const loanAmount = app.requestedAmount || 0;

  // Retrieve affordability values from affordabilityOutcome
  const basicSalary = app.affordabilityOutcome?.income?.basicSalary || 0;
  const allowances = app.affordabilityOutcome?.income?.allowances || 0;
  
  // Sum other income (allowances, overtime, otherIncome)
  const overtime = app.affordabilityOutcome?.income?.overtime || 0;
  const otherIncomeVal = app.affordabilityOutcome?.income?.otherIncome || 0;
  const otherIncome = overtime + otherIncomeVal;

  const expenses = app.affordabilityOutcome?.expenses?.totalExpenses || 0;
  const monthlyInstallment = app.estimatedMonthlyEMI || 0;
  const applicationProduct = app.loanType || '';
  const employmentType = borrower?.employmentStatus || '';

  const hashInputs = [
    String(borrowerId),
    String(idNumber),
    String(phoneNumber),
    String(loanAmount),
    String(basicSalary),
    String(allowances),
    String(otherIncome),
    String(expenses),
    String(monthlyInstallment),
    String(applicationProduct),
    String(employmentType)
  ];

  const hashString = hashInputs.join('|');
  return crypto.createHash('sha256').update(hashString).digest('hex');
};

module.exports = {
  generateVerificationHash
};
