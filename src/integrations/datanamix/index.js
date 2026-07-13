/**
 * Datanamix Integrations Module Entrypoint
 * Orchestrates and exposes unified client interfaces for identity, banking, credit, phone, and compliance.
 */

const { getAccessToken, clearTokenCache } = require('./auth/token.service');
const { verifyIdentity } = require('./identity/idVerification.service');
const { verifyFaceLiveness, getFaceSessionToken } = require('./identity/faceVerification.service');
const { verifyBankAccount } = require('./bank/bankVerification.service');
const { getConsumerCreditReport } = require('./credit/creditReport.service');
const { verifyPhoneOwnership } = require('./phone/phoneVerification.service');
const { screenAML } = require('./aml/amlScreening.service');

const ocr = require('./ocr');

module.exports = {
  // Authentication & Token management
  auth: {
    getAccessToken,
    clearTokenCache
  },
  
  // Borrower Identity Verify
  identity: {
    verifyIdentity,       // DHA IDV + Photo matching
    verifyFaceLiveness,   // FaceTec 3D liveness scan
    getFaceSessionToken
  },
  
  // Bank Account Ownership Verify
  bank: {
    verifyBankAccount     // Account Holder Verification Advanced
  },
  
  // Credit Bureau Analytics
  credit: {
    getConsumerCreditReport // Consumer Credit Report
  },
  
  // Mobile Network Ownership Verify
  phone: {
    verifyPhoneOwnership   // Carrier Identity validation
  },
  
  // Compliance / Risk Screening
  aml: {
    screenAML             // Sanctions + PEP + Crime databases
  },

  // Optical Character Recognition (OCR)
  ocr
};
