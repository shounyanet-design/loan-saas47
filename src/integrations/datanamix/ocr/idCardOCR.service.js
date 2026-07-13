/**
 * ID Card OCR Service
 * Handles extraction of details from South African ID Cards/Books.
 * 
 * TODO: Implement live API connection and data mapping when endpoints are active.
 */

const { datanamixClient } = require('../shared/datanamixClient');
const datanamixConfig = require('../../../config/datanamix.config');
const { parseOCRResponse } = require('./ocrParser.service');

/**
 * Initiates OCR extraction for ID documents
 * @param {Object} documentData - Base64 encoded document image and metadata
 * @returns {Promise<Object>} Extracted data or status placeholder
 */
const extractIDDetails = async (documentData = {}) => {
  console.log(`🪪 [Datanamix OCR Service]: Triggering ID Card OCR extraction.`);

  // Placeholder for OCR payload structure
  const payload = {
    documentImage: documentData.base64Image,
    documentType: 'ID_DOCUMENT',
    options: {
      extractFace: true,
      extractBarcode: true
    }
  };

  try {
    // TODO: Perform real request to OCR endpoint once activated
    // const response = await datanamixClient({
    //   endpoint: datanamixConfig.endpoints.ocr.idCard,
    //   method: 'POST',
    //   data: payload
    // });

    console.log(`📝 [Datanamix ID OCR TODO]: Map ID number, names, DOB, gender, and issue date.`);

    // Structured return placeholder simulating the future response
    return {
      success: false,
      extractionStatus: 'FOUNDATION_READY',
      extractedData: {
        idNumber: null,
        firstName: null,
        lastName: null,
        dateOfBirth: null,
        gender: null,
        countryOfIssue: null,
        issueDate: null,
      },
      confidenceScores: {},
      audit: null
    };
  } catch (error) {
    console.error('❌ [ID Card OCR Service Error]:', error.message);
    throw error;
  }
};

module.exports = {
  extractIDDetails
};
