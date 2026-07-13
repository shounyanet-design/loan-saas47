const AgreementOTP = require('../models/AgreementOTP');

/**
 * Verifies a borrower's OTP for a specific loan application
 * @param {string} borrowerId - ID of the borrower user
 * @param {string} loanApplicationId - ID of the loan application
 * @param {string} otpCode - Entered OTP code
 * @returns {Promise<boolean>} True if successfully verified
 */
const verifyOTP = async (borrowerId, loanApplicationId, otpCode) => {
  // Find the latest unverified OTP record
  const latestOtp = await AgreementOTP.findOne({
    borrowerId,
    loanApplicationId,
    verified: false,
  }).sort({ createdAt: -1 });

  if (!latestOtp) {
    throw new Error('No active OTP request found. Please request a new OTP.');
  }

  // 1. Check expiration
  if (new Date() > new Date(latestOtp.expiresAt)) {
    throw new Error('OTP has expired. Please request a new OTP.');
  }

  // 2. Check retry attempts / Brute Force Prevention
  if (latestOtp.attempts >= 5 || latestOtp.retryCount >= 5) {
    // Invalidate the OTP immediately
    latestOtp.expiresAt = new Date();
    await latestOtp.save();
    throw new Error('Maximum retry attempts exceeded. This OTP has been invalidated. Please request a new OTP.');
  }

  // 3. Compare code
  if (latestOtp.otpCode !== otpCode) {
    latestOtp.attempts += 1;
    latestOtp.retryCount += 1;
    await latestOtp.save();
    
    const remaining = 5 - latestOtp.attempts;
    if (remaining === 0) {
      latestOtp.expiresAt = new Date();
      await latestOtp.save();
      throw new Error('Incorrect OTP. Maximum attempts exceeded. OTP invalidated.');
    }
    throw new Error(`Incorrect OTP code. ${remaining} attempts remaining.`);
  }

  // 4. Mark as verified & prevent future reuse
  latestOtp.verified = true;
  await latestOtp.save();

  return true;
};

module.exports = {
  verifyOTP,
};
