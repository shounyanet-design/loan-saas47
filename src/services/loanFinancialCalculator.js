/**
 * loanFinancialCalculator.js
 * Single Authoritative Financial Calculation Engine for Point.47 Lending SaaS
 * 
 * Compliant with South African National Credit Act (NCA) regulations.
 * Handles:
 * - Reducing Balance Amortization (Personal, Business, Debt Consolidation)
 * - Flat Rate Interest (Payday, Salary Advance)
 * - Zero-Interest Edge Cases (baseEmi = principal / duration)
 * - Initiation Fees (Percentage or Fixed Amount based on tenant/product config)
 * - Monthly Service Fees (Tenant SystemSettings)
 * - Credit Life Insurance (Tenant/Product rate)
 * - Value Added Tax (VAT on fees)
 * - Exact 2-decimal rounding with remainder absorption on schedules
 */

/**
 * Standard 2-decimal currency rounding with Number.EPSILON to prevent float rounding errors
 * @param {number|string} num
 * @returns {number}
 */
function round2(num) {
  const n = Number(num);
  if (isNaN(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate dynamic NCR-compliant initiation fee
 * 
 * South African National Credit Act (NCA / NCR) Statutory Formula:
 * - principal <= 0 => 0.00
 * - principal <= R1,000 => baseFee (R165.00)
 * - principal > R1,000 => baseFee (R165.00) + excessPercentage (10%) * (principal - threshold (R1,000))
 * - Cap: maximumFee (R1,050.00)
 * 
 * @param {number} principal - Loan principal amount
 * @param {Object} [config] - System/tenant configuration
 * @returns {number} 2-decimal rounded initiation fee
 */
function calculateInitiationFee(principal, config = {}) {
  const p = Math.max(0, round2(principal));
  if (p <= 0) return 0;

  const calculationType = config?.initiationFeeType || 'NCR_STANDARD';
  const statutoryCap = 1050.00;

  // 1. Explicit Fixed Amount Override (capped by regulatory ceiling)
  if (calculationType === 'Fixed Amount') {
    const fixedFee = round2(Number(config?.initiationFeeValue ?? 165));
    const cap = Math.min(statutoryCap, Math.max(0, Number(config?.initiationFeeCap ?? statutoryCap)));
    return round2(Math.min(fixedFee, cap));
  }

  // 2. Explicit Percentage Override (capped by regulatory ceiling)
  if (calculationType === 'Percentage') {
    const pct = Number(config?.initiationFeeValue ?? 10);
    const fee = round2((p * pct) / 100);
    const cap = Math.min(statutoryCap, Math.max(0, Number(config?.initiationFeeCap ?? statutoryCap)));
    return round2(Math.min(fee, cap));
  }

  // 3. Authoritative NCR_STANDARD Formula
  // Base Fee: default R165 (cannot exceed R165)
  const baseFee = Math.min(165, Math.max(0, Number(config?.initiationFeeBaseFee ?? 165)));
  // Threshold: default R1,000
  const threshold = Math.max(0, Number(config?.initiationFeeThreshold ?? 1000));
  // Excess Percentage: default 10% (cannot exceed 10%)
  const excessPct = Math.min(10, Math.max(0, Number(config?.initiationFeeExcessPercentage ?? 10)));
  // Maximum Cap: default R1,050 (cannot exceed R1,050)
  const maxCap = Math.min(statutoryCap, Math.max(0, Number(config?.initiationFeeCap ?? statutoryCap)));

  let fee = baseFee;
  if (p > threshold) {
    const excess = p - threshold;
    fee = baseFee + round2(excess * (excessPct / 100));
  }

  return round2(Math.min(fee, maxCap));
}

/**
 * Format a number as South African Rand (e.g., "R 3,236.48")
 * @param {number} num
 * @returns {string}
 */
function formatZAR(num) {
  const val = Number(num) || 0;
  return `R ${val.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Calculate comprehensive financial snapshot for a loan
 * 
 * @param {Object} params
 * @param {number} params.amount - Principal loan amount
 * @param {number} params.duration - Duration in months
 * @param {number} [params.interestRate] - Annual interest rate override (optional)
 * @param {string} [params.interestType] - 'Reducing Balance' or 'Flat Rate'
 * @param {Object} [params.settings] - Tenant SystemSettings document/object
 * @param {Object} [params.selectedProduct] - Selected loan product configuration
 * @returns {Object} Authoritative financial snapshot
 */
function calculateLoanFinances({
  amount,
  duration,
  interestRate,
  interestType,
  settings = {},
  selectedProduct = null
}) {
  const principalAmount = Math.max(0, round2(amount));
  const durationMonths = Math.max(1, Math.round(Number(duration) || 1));

  // Determine Product / Interest Settings
  const productInterestType = selectedProduct?.interestType || 
                              settings?.interestType || 
                              interestType || 
                              'Reducing Balance';

  // Determine Effective Annual Interest Rate
  let annualRate = 0;
  if (interestRate !== undefined && interestRate !== null && interestRate !== '') {
    annualRate = Math.max(0, Number(interestRate));
  } else if (selectedProduct?.defaultInterestRate !== undefined) {
    annualRate = Math.max(0, Number(selectedProduct.defaultInterestRate));
  } else if (settings?.defaultInterestRate !== undefined) {
    annualRate = Math.max(0, Number(settings.defaultInterestRate));
  } else {
    annualRate = 12.5; // Platform fallback
  }

  // 1. Calculate Base EMI & Pure Interest
  let baseEmi = 0;
  let pureInterestAmount = 0;

  if (principalAmount > 0) {
    if (annualRate === 0) {
      // Zero-interest edge case
      baseEmi = round2(principalAmount / durationMonths);
      pureInterestAmount = 0;
    } else if (productInterestType === 'Flat Rate') {
      // Simple Flat Rate: Total Interest = Principal * (Rate / 100) * (Duration / 12) or flat annual
      // Standard Point.47 flat calculation: totalInterest = Principal * (Rate / 100) * (duration / 12)
      const annualizedTerm = durationMonths / 12;
      const flatInterest = principalAmount * (annualRate / 100) * annualizedTerm;
      pureInterestAmount = round2(flatInterest);
      baseEmi = round2((principalAmount + pureInterestAmount) / durationMonths);
    } else {
      // Reducing Balance Amortization Annuity: P * r * (1+r)^N / ((1+r)^N - 1)
      const monthlyRate = (annualRate / 100) / 12;
      if (monthlyRate === 0) {
        baseEmi = round2(principalAmount / durationMonths);
        pureInterestAmount = 0;
      } else {
        const factor = Math.pow(1 + monthlyRate, durationMonths);
        const rawEmi = (principalAmount * monthlyRate * factor) / (factor - 1);
        const rawTotalBase = rawEmi * durationMonths;
        baseEmi = round2(rawEmi);
        pureInterestAmount = round2(rawTotalBase - principalAmount);
      }
    }
  }

  // 2. Initiation / Processing Fee (Central Dynamic NCR Standard)
  let initiationFeeAmount = 0;
  const processingFeeEnabled = selectedProduct?.processingFeeEnabled !== false;
  if (processingFeeEnabled && principalAmount > 0) {
    initiationFeeAmount = calculateInitiationFee(principalAmount, settings);
  }

  // 3. Monthly Service Fee
  const monthlyServiceFee = principalAmount > 0 
    ? round2(Number(settings?.monthlyServiceFee ?? 60)) 
    : 0;
  const totalServiceFeeAmount = round2(monthlyServiceFee * durationMonths);

  // 4. Credit Life Insurance
  let insuranceAmount = 0;
  const insuranceEnabled = selectedProduct?.insuranceEnabled !== false;
  if (insuranceEnabled && principalAmount > 0) {
    const insuranceRate = Number(settings?.creditLifeInsuranceRate ?? 1.2);
    // Insurance annualized over the loan tenure
    const annualizedTerm = durationMonths / 12;
    insuranceAmount = round2((principalAmount * (insuranceRate / 100)) * annualizedTerm);
  }

  // 5. Value Added Tax (VAT on fees)
  let vatAmount = 0;
  const vatEnabled = selectedProduct?.vatEnabled !== false;
  if (vatEnabled && principalAmount > 0) {
    const vatRate = Number(settings?.vatPercentage ?? 15);
    // VAT is levied on Initiation Fee + Total Service Fees
    vatAmount = round2((initiationFeeAmount + totalServiceFeeAmount) * (vatRate / 100));
  }

  // 6. Total Cost of Credit & Total Repayment
  const totalCostOfCreditAmount = round2(
    pureInterestAmount + initiationFeeAmount + totalServiceFeeAmount + insuranceAmount + vatAmount
  );
  const totalRepaymentAmount = round2(principalAmount + totalCostOfCreditAmount);
  const monthlyInstallmentAmount = round2(totalRepaymentAmount / durationMonths);

  return {
    principalAmount,
    annualInterestRate: annualRate,
    monthlyInterestRate: round2(annualRate / 12),
    durationMonths,
    interestType: productInterestType,
    baseEmi,
    pureInterestAmount,
    initiationFeeAmount,
    monthlyServiceFee,
    totalServiceFeeAmount,
    insuranceAmount,
    vatAmount,
    totalCostOfCreditAmount,
    totalRepaymentAmount,
    monthlyInstallmentAmount,
    calculatedAt: new Date(),
    calculatorVersion: '2.0.0'
  };
}

/**
 * Generate an exact repayment schedule where the final installment absorbs rounding delta
 * 
 * Guarantee: sum(schedule[i].emiAmount) === totalRepaymentAmount EXACTLY.
 * 
 * @param {Object} params
 * @param {number} params.totalRepaymentAmount - Total amount to be collected
 * @param {number} params.durationMonths - Number of installments
 * @param {Date} [params.startDate] - Loan start date (defaults to today)
 * @returns {Array<Object>} Schedule entries
 */
function generateRepaymentSchedule({
  totalRepaymentAmount,
  durationMonths,
  startDate = new Date()
}) {
  const total = round2(totalRepaymentAmount);
  const duration = Math.max(1, Math.round(Number(durationMonths) || 1));
  const standardEmi = round2(total / duration);
  const schedule = [];
  let allocated = 0;

  for (let i = 1; i <= duration; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);

    let amount;
    if (i === duration) {
      // Final installment absorbs any 1-cent rounding difference
      amount = round2(total - allocated);
    } else {
      amount = standardEmi;
      allocated = round2(allocated + amount);
    }

    schedule.push({
      installmentNumber: i,
      emiNumber: i,
      dueDate,
      emiAmount: amount,
      amount: amount,
      principalAmount: round2(amount),
      interestAmount: 0,
      paymentStatus: 'Pending',
      status: 'Pending',
      penaltyAmount: 0,
      amountPaid: 0
    });
  }

  return schedule;
}

module.exports = {
  round2,
  formatZAR,
  calculateInitiationFee,
  calculateLoanFinances,
  generateRepaymentSchedule
};
