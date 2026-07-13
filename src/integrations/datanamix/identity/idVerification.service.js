/**
 * Identity Verification Service
 * Handles: DATANAMIX PROFILE IDV PLUS PHOTO
 * Verifies a borrower's identity details and cross-checks their uploaded selfie photo.
 */

const { datanamixClient } = require('../shared/datanamixClient');
const datanamixConfig = require('../../../config/datanamix.config');

/**
 * Initiates borrower ID Verification (IDV Plus Photo)
 * @param {Object} borrowerData - Details of borrower (idNumber, fullName, base64SelfiePhoto, etc.)
 * @returns {Promise<Object>} API verification results or status placeholders
 */
const verifyIdentity = async (borrowerData = {}) => {
  const { idNumber, fullName, dateOfBirth, selfiePhotoBase64 } = borrowerData;

  console.log(`👤 [Datanamix Service]: Triggering ID Verification for ID: ${idNumber || 'N/A'}`);

  // Structuring the request payload as per DATANAMIX IDV specifications
  const payload = {
    idNumber,
    fullName,
    dateOfBirth,
    photoData: selfiePhotoBase64, // Base64 selfie comparison
    options: {
      enablePhotoMatch: !!selfiePhotoBase64,
      verificationSource: 'DHA' // Department of Home Affairs or similar authority
    }
  };

  try {
    // TODO: Perform real request to verify endpoint once credentials are live
    const response = await datanamixClient({
      endpoint: datanamixConfig.endpoints.idVerification,
      method: 'POST',
      data: payload
    });

    console.log(`📝 [Datanamix IDV TODO]: Map and process DHA match results when credentials are supplied.`);

    // Structured return placeholder
    return {
      verified: false,
      verificationStatus: 'FOUNDATION_READY',
      idNumber,
      fullName,
      photoMatchConfidence: null,
      dhaData: {
        aliveStatus: null,
        namesMatch: null,
        surnameMatch: null
      },
      audit: response
    };
  } catch (error) {
    console.error('❌ [Datanamix IDV Service Error]:', error.message);
    throw error;
  }
};

module.exports = {
  verifyIdentity
};
