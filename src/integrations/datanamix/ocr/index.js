/**
 * Datanamix OCR Module Entrypoint
 * Orchestrates and exposes unified client interfaces for OCR extraction and validation.
 */

const { extractIDDetails } = require('./idCardOCR.service');
const { extractAddressDetails } = require('./proofOfResidenceOCR.service');
const { extractBankStatementDetails } = require('./bankStatementOCR.service');
const { parseOCRResponse } = require('./ocrParser.service');
const { validateOCRMatch } = require('./ocrValidation.service');

module.exports = {
  extraction: {
    extractIDDetails,
    extractAddressDetails,
    extractBankStatementDetails
  },
  utils: {
    parseOCRResponse,
    validateOCRMatch
  }
};
