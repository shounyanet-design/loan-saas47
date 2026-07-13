/**
 * Datanamix Integration Configuration
 * Prepares environment keys and endpoints for enterprise credit, identity, bank, phone, and AML verification services.
 */

const datanamixConfig = {
  clientId: process.env.DATANAMIX_CLIENT_ID || '',
  clientSecret: process.env.DATANAMIX_CLIENT_SECRET || '',
  
  // Set mode to sandbox if credentials or parameters dictate sandbox testing
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
  
  endpoints: {
    tokenUrl: process.env.DATANAMIX_TOKEN_URL || 'https://api.datanamix.co.za/oauth/token',
    idVerification: process.env.DATANAMIX_IDV_URL || 'https://api.datanamix.co.za/v1/identity/verify',
    faceVerification: process.env.DATANAMIX_FACETEC_URL || 'https://api.datanamix.co.za/v1/facetec/liveness',
    bankVerification: process.env.DATANAMIX_BANK_URL || 'https://api.datanamix.co.za/v1/bank/verify',
    creditReport: process.env.DATANAMIX_CREDIT_URL || 'https://api.datanamix.co.za/v1/credit/consumer-report',
    phoneVerification: process.env.DATANAMIX_PHONE_URL || 'https://api.datanamix.co.za/v1/phone/verify',
    amlScreening: process.env.DATANAMIX_AML_URL || 'https://api.datanamix.co.za/v1/aml/screening',
    ocr: {
      idCard: process.env.DATANAMIX_ID_OCR_URL || 'https://api.datanamix.co.za/v1/ocr/id-card',
      proofOfResidence: process.env.DATANAMIX_PROOF_OF_RESIDENCE_OCR_URL || 'https://api.datanamix.co.za/v1/ocr/proof-of-residence',
      bankStatement: process.env.DATANAMIX_BANK_STATEMENT_OCR_URL || 'https://api.datanamix.co.za/v1/ocr/bank-statement'
    }
  },
  
  // Timeout for Datanamix client HTTP requests (default 30 seconds)
  requestTimeout: 30000,
  
  // Retry configuration for transient network/gateway failures
  retryConfig: {
    maxRetries: 3,
    retryDelayMs: 1000,
    backoffFactor: 2
  }
};

module.exports = datanamixConfig;
