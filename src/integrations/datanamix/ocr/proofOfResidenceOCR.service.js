/**
 * Proof of Residence OCR Service
 * Handles extraction of address and utility bill details.
 * 
 * TODO: Implement live API connection and data mapping when endpoints are active.
 */

const { datanamixClient } = require('../shared/datanamixClient');
const datanamixConfig = require('../../../config/datanamix.config');
const { parseOCRResponse } = require('./ocrParser.service');

/**
 * Initiates OCR extraction for Proof of Residence documents (Utility Bills, etc.)
 * @param {Object} documentData - Base64 encoded document image and metadata
 * @returns {Promise<Object>} Extracted data or status placeholder
 */
const extractAddressDetails = async (documentData = {}) => {
  console.log(`📄 [Datanamix OCR Service]: Triggering Proof of Residence OCR extraction.`);

  const payload = {
    documentImage: documentData.base64Image,
    documentType: 'PROOF_OF_RESIDENCE',
    options: {
      extractAddress: true,
      extractIssuerName: true,
      extractIssueDate: true
    }
  };

  try {
    // TODO: Connect to real endpoint
    // const response = await datanamixClient({ ... });

    console.log(`📝 [Datanamix Address OCR TODO]: Map physical address, issuer name, and document age.`);

    return {
      success: false,
      extractionStatus: 'FOUNDATION_READY',
      extractedData: {
        physicalAddress: null,
        city: null,
        postalCode: null,
        issuerName: null,
        issueDate: null,
        documentAgeDays: null
      },
      confidenceScores: {},
      audit: null
    };
  } catch (error) {
    console.error('❌ [Proof of Residence OCR Service Error]:', error.message);
    throw error;
  }
};

module.exports = {
  extractAddressDetails
};
