/**
 * Bank Statement OCR Service
 * Handles extraction of transactions, income, and affordability metrics from bank statements.
 * 
 * TODO: Implement live API connection and data mapping when endpoints are active.
 */

const { datanamixClient } = require('../shared/datanamixClient');
const datanamixConfig = require('../../../config/datanamix.config');
const { parseOCRResponse } = require('./ocrParser.service');

/**
 * Initiates OCR extraction for Bank Statements
 * @param {Object} documentData - Base64 encoded document image and metadata
 * @returns {Promise<Object>} Extracted data or status placeholder
 */
const extractBankStatementDetails = async (documentData = {}) => {
  console.log(`🏦 [Datanamix OCR Service]: Triggering Bank Statement OCR extraction.`);

  const payload = {
    documentImage: documentData.base64Image,
    documentType: 'BANK_STATEMENT',
    options: {
      extractTransactions: true,
      calculateAffordability: true,
      extractAccountHolder: true
    }
  };

  try {
    // TODO: Connect to real endpoint
    // const response = await datanamixClient({ ... });

    console.log(`📝 [Datanamix Bank Statement OCR TODO]: Map income, expenses, account details, and affordability metrics.`);

    return {
      success: false,
      extractionStatus: 'FOUNDATION_READY',
      extractedData: {
        accountHolderName: null,
        accountNumber: null,
        bankName: null,
        statementPeriodStart: null,
        statementPeriodEnd: null,
        affordability: {
          averageMonthlyIncome: null,
          averageMonthlyExpenses: null,
          disposableIncome: null
        }
      },
      confidenceScores: {},
      audit: null
    };
  } catch (error) {
    console.error('❌ [Bank Statement OCR Service Error]:', error.message);
    throw error;
  }
};

module.exports = {
  extractBankStatementDetails
};
