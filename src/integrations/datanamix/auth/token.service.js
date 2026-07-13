/**
 * Datanamix Token Management Service
 * Delegates caching and token resolution to the centralized tenant-aware datanamixAuth.service.js.
 */

const { getAccessToken: getCentralAccessToken } = require('../../../services/datanamix/datanamixAuth.service');
const tenantContext = require('../../../tenancy/tenantContext');

/**
 * Retrieves a valid Datanamix Bearer access token for the current tenant.
 * @returns {Promise<String>} The Bearer access token
 */
const getAccessToken = async () => {
  const tenantId = tenantContext.getTenantId();
  return getCentralAccessToken(tenantId);
};

const clearTokenCache = () => {
  // Handled at central service level
};

const isTokenValid = () => {
  return false; // Delegate validity check to central auth service
};

module.exports = {
  getAccessToken,
  clearTokenCache,
  isTokenValid
};
