/**
 * Unified Datanamix API Client Wrapper
 * Integrates token management, base request options, headers, and error catching.
 */

const { getAccessToken } = require('../auth/token.service');
const { executeRequest } = require('./requestHandler');
const tenantContext = require('../../../tenancy/tenantContext');
const credentialService = require('../../../modules/saas/services/credentialService');
const datanamixConfig = require('../../../config/datanamix.config');

/**
 * Standardized client method for communicating with verified Datanamix endpoints
 * @param {Object} requestOptions - Sub-request configurations (endpoint, method, payload, headers)
 * @returns {Promise<Object>} The resolved API response
 */
const datanamixClient = async (requestOptions = {}) => {
  let { endpoint, method = 'POST', data = null, params = null, headers = {} } = requestOptions;

  try {
    const tenantId = tenantContext.getTenantId();
    const token = await getAccessToken();

    // Resolve dynamic Base URL if tenant settings exist
    if (tenantId) {
      const resolved = await credentialService.resolve(tenantId, 'datanamix');
      if (resolved && resolved.source === 'tenant') {
        const creds = resolved.credentials || {};
        if (creds.baseUrl) {
          const configBaseUrl = (datanamixConfig.baseUrl || 'https://api.datanamix.com').replace(/\/$/, '');
          let tenantBaseUrl;
          try {
            tenantBaseUrl = new URL(creds.baseUrl).origin;
          } catch (e) {
            tenantBaseUrl = creds.baseUrl.replace(/\/$/, '');
          }
          if (endpoint.startsWith(configBaseUrl)) {
            endpoint = endpoint.replace(configBaseUrl, tenantBaseUrl);
          } else if (endpoint.startsWith('/')) {
            endpoint = `${tenantBaseUrl}${endpoint}`;
          }
        }
      }
    }

    // Build full request headers
    const requestHeaders = {
      'Authorization': `Bearer ${token}`,
      ...headers
    };

    // Fire the request using request handler
    const response = await executeRequest({
      url: endpoint,
      method,
      data,
      params,
      headers: requestHeaders
    });

    return response;
  } catch (error) {
    console.error(`❌ [Datanamix Client Request Failure] URL: ${endpoint} | Error:`, error.message);
    throw error;
  }
};

module.exports = {
  datanamixClient
};
