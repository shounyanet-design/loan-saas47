const AgreementOTP = require('../models/AgreementOTP');
const { generateSecureOTP } = require('../../../utils/otp.util');

/**
 * Generates and saves a new OTP for a loan agreement
 * @param {string} borrowerId - ID of the borrower user
 * @param {string} loanApplicationId - ID of the loan application
 * @returns {Promise<Object>} Created AgreementOTP document
 */
const generateAndSaveOTP = async (borrowerId, loanApplicationId) => {
  // 1. Invalidate any existing active OTPs for this loan application/borrower to prevent multiple active OTPs
  await AgreementOTP.updateMany(
    { borrowerId, loanApplicationId, verified: false },
    { $set: { expiresAt: new Date() } } // Set expiry to now (invalidating them)
  );

  // 2. Generate new 6 digit OTP
  const otpCode = generateSecureOTP();

  // 3. Calculate expiry date
  const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 5;
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + expiryMinutes);

  // 4. Create and save new OTP record
  const agreementOTP = await AgreementOTP.create({
    borrowerId,
    loanApplicationId,
    otpCode,
    expiresAt,
    verified: false,
    attempts: 0,
  });

  return agreementOTP;
};

module.exports = {
  generateAndSaveOTP,
};
