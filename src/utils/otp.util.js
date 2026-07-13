const crypto = require('crypto');

/**
 * Generates a secure, 6-digit numeric OTP
 * @returns {string} 6-digit OTP
 */
const generateSecureOTP = () => {
  // Generate a random value using cryptographically secure pseudorandom number generator
  return crypto.randomInt(100000, 999999).toString();
};

module.exports = {
  generateSecureOTP,
};
