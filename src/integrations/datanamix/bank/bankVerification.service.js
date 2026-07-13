/**
 * Bank Verification Service
 * Handles: ACCOUNT HOLDER VERIFICATION ADVANCED (AHV)
 * Assures the bank account exists, is active, matches the borrower's ID, and checks account age.
 */

const { datanamixClient } = require('../shared/datanamixClient');
const datanamixConfig = require('../../../config/datanamix.config');

/**
 * Validates bank account details and holder match status
 * @param {Object} bankData - Bank details (bankName, accountNumber, branchCode, idNumber, accountHolderName)
 * @returns {Promise<Object>} Verification results or status placeholders
 */
const verifyBankAccount = async (bankData = {}) => {
  const { bankName, accountNumber, branchCode, idNumber, accountHolderName, accountType } = bankData;

  console.log(`🏦 [Datanamix Service]: Triggering Bank Account Verification for account: ${accountNumber || 'N/A'}`);

  const payload = {
    accountNumber,
    bankName,
    branchCode,
    idNumber,
    accountHolderName,
    accountType: accountType || 'Savings',
    verificationLevel: 'ADVANCED'
  };

  try {
    // TODO: Connect to Datanamix AHV endpoint when credentials are active
    const response = await datanamixClient({
      endpoint: datanamixConfig.endpoints.bankVerification,
      method: 'POST',
      data: payload
    });

    console.log(`📝 [Datanamix Bank TODO]: Map real-time CDV and AHV responses (match/mismatch indicators).`);

    return {
      verified: false,
      verificationStatus: 'FOUNDATION_READY',
      bankDetails: {
        accountNumber,
        bankName,
        branchCode
      },
      matchIndicators: {
        idNumberMatch: null,    // Y/N/U (Yes / No / Unknown)
        nameMatch: null,        // Y/N/U
        accountActive: null,    // Y/N/U
        acceptsDebits: null,    // Y/N/U
        acceptsCredits: null    // Y/N/U
      },
      audit: response
    };
  } catch (error) {
    console.error('❌ [Datanamix Bank Service Error]:', error.message);
    throw error;
  }
};

module.exports = {
  verifyBankAccount
};
