/**
 * Phone Verification Service
 * Handles: CARRIER IDENTITY
 * Cross-checks phone number ownership, carrier assignment, active status, and matching identity tags.
 */

const { datanamixClient } = require('../shared/datanamixClient');
const datanamixConfig = require('../../../config/datanamix.config');

const validateSAPhone = (phone) => {
  if (!phone) return false;
  return /^0\d{9}$/.test(phone.trim());
};

const validateFullName = (name) => {
  if (!name) return false;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const words = trimmed.split(' ').filter(Boolean);
  if (words.length < 2) return false;
  return /^[a-zA-Z\s]+$/.test(trimmed);
};

const formatFullName = (name) => {
  if (!name) return '';
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Verifies carrier registration status and customer matching tags
 * @param {Object} phoneData - Details (phoneNumber, idNumber, fullName)
 * @returns {Promise<Object>} Verification results or status placeholders
 */
const verifyPhoneOwnership = async (phoneData = {}) => {
  const { phoneNumber, idNumber, fullName } = phoneData;

  if (!validateSAPhone(phoneNumber)) {
    throw new Error('Enter a valid South African phone number.');
  }

  if (!validateFullName(fullName)) {
    throw new Error('Enter borrower full legal name.');
  }

  const formattedName = formatFullName(fullName);

  console.log(`📱 [Datanamix Service]: Triggering Carrier Identity checks for Phone: ${phoneNumber || 'N/A'}`);

  const payload = {
    phoneNumber,
    idNumber,
    fullName: formattedName
  };

  try {
    // TODO: Connect to Datanamix phone verification endpoint once credentials are active
    const response = await datanamixClient({
      endpoint: datanamixConfig.endpoints.phoneVerification,
      method: 'POST',
      data: payload
    });

    console.log(`📝 [Datanamix Phone Verification TODO]: Map SIM swap date, ownership, and network carrier status.`);

    return {
      verified: false,
      verificationStatus: 'FOUNDATION_READY',
      phoneNumber,
      networkCarrier: null,        // e.g., Vodacom, MTN, Cell C
      simSwapDetected: null,
      identityMatchResult: {
        idNumberMatched: null,     // Match indicator
        fullNameMatched: null      // Match indicator
      },
      audit: response
    };
  } catch (error) {
    console.error('❌ [Datanamix Phone Service Error]:', error.message);
    throw error;
  }
};

module.exports = {
  verifyPhoneOwnership
};
