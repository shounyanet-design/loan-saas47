const axios = require('axios');
const { datanamixClient } = require('../shared/datanamixClient');
const datanamixConfig = require('../../../config/datanamix.config');

/**
 * Requests a new FaceTec session token
 * @returns {Promise<Object>} The session token payload
 */
const getFaceSessionToken = async () => {
  const baseUrl = datanamixConfig.endpoints.faceVerification || '';
  
  if (baseUrl.includes('chana-onprem-usage-logs.datanamix.com') || baseUrl.includes('api.facetec.com')) {
    const url = baseUrl.endsWith('/') ? `${baseUrl}session-token` : `${baseUrl}/session-token`;
    console.log(`[FaceTec] Requesting Session Token directly from server: ${url}`);
    
    const response = await axios.get(url, {
      headers: {
        'X-Device-Key-Identifier': process.env.FACETEC_DEVICE_KEY_IDENTIFIER || 'dummy-device-key',
        'X-Device-Key': process.env.FACETEC_DEVICE_KEY_IDENTIFIER || 'dummy-device-key',
        'X-User-Agent': 'FaceTecSDK-browser-9.7.120',
      },
      timeout: 10000
    });
    return response.data;
  }
  
  const tokenUrl = baseUrl.replace('/liveness', '/session-token');
  console.log(`[Datanamix] Requesting Session Token through proxy: ${tokenUrl}`);
  const response = await datanamixClient({
    endpoint: tokenUrl,
    method: 'GET'
  });
  return response;
};

/**
 * Initiates FaceTec Liveness 3D session validation
 * @param {Object} sessionData - FaceTec 3D FaceScan payload, session id
 * @returns {Promise<Object>} Verification results
 */
const verifyFaceLiveness = async (sessionData = {}) => {
  const { faceScan, auditTrailImage, sessionId } = sessionData;

  console.log(`🎭 [FaceTec Service]: Triggering FaceLiveness verification for session: ${sessionId || 'N/A'}`);

  const baseUrl = datanamixConfig.endpoints.faceVerification || '';

  // Direct FaceTec Server implementation
  if (baseUrl.includes('chana-onprem-usage-logs.datanamix.com') || baseUrl.includes('api.facetec.com')) {
    const url = baseUrl.endsWith('/') ? `${baseUrl}liveness-3d` : `${baseUrl}/liveness-3d`;
    console.log(`[FaceTec] POST to direct endpoint: ${url}`);
    try {
      const response = await axios.post(url, {
        faceScan,
        auditTrailImage,
        sessionId
      }, {
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Key-Identifier': process.env.FACETEC_DEVICE_KEY_IDENTIFIER || 'dummy-device-key',
          'X-Device-Key': process.env.FACETEC_DEVICE_KEY_IDENTIFIER || 'dummy-device-key',
          'X-User-Agent': 'FaceTecSDK-browser-9.7.120',
        },
        timeout: 15000
      });

      const data = response.data;
      const success = data?.wasSuccessful === true || data?.success === true;
      return {
        success,
        livenessStatus: success ? 'Passed' : 'Failed',
        livenessConfidence: data?.livenessConfidenceScore ?? (success ? 100 : 0),
        spoofDetected: data?.spoofDetected ?? !success,
        sessionRef: sessionId,
        audit: data
      };
    } catch (error) {
      console.error('❌ [FaceTec Direct Server Error]:', error.message);
      throw error;
    }
  }

  // Datanamix Proxy implementation
  const payload = {
    faceScan,
    auditTrailImage,
    sessionId,
    verificationType: '3D_LIVENESS'
  };

  try {
    const response = await datanamixClient({
      endpoint: baseUrl,
      method: 'POST',
      data: payload
    });

    const isApiSuccess = response?.Success === true && (response?.ResponseCode === 200 || response?.ResponseCode === 0);
    const livenessResult = response?.Result ?? {};
    const isLivenessPassed = isApiSuccess && (
      livenessResult?.LivenessStatus === 'Passed' || 
      livenessResult?.LivenessStatus === 'Success' ||
      livenessResult?.LivenessStatus === 'Verified' ||
      livenessResult?.Success === true ||
      livenessResult?.LivenessPassed === true
    );

    return {
      success: isLivenessPassed,
      livenessStatus: livenessResult?.LivenessStatus || (isLivenessPassed ? 'Passed' : 'Failed'),
      livenessConfidence: livenessResult?.LivenessConfidence ?? livenessResult?.ConfidenceScore ?? (isLivenessPassed ? 100 : 0),
      spoofDetected: livenessResult?.SpoofDetected ?? false,
      sessionRef: sessionId,
      audit: response
    };
  } catch (error) {
    console.error('❌ [Datanamix FaceTec Service Error]:', error.message);
    throw error;
  }
};

module.exports = {
  getFaceSessionToken,
  verifyFaceLiveness
};
