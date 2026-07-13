/**
 * Datanamix OAuth Service
 * Delegates to the centralized email/password auth service.
 * token.service.js calls fetchNewAccessToken() — we bridge it to the new system.
 */

const { getAccessToken } = require('../../../services/datanamix/datanamixAuth.service');

/**
 * Returns a valid access token from the centralized auth service.
 * token.service.js caches this result independently; that is harmless.
 */
const fetchNewAccessToken = async () => {
  console.log('[Datanamix Auth] Fetching access token via centralized auth service...');

  const token = await getAccessToken();

  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: 3600,
    createdAt: Date.now(),
  };
};

module.exports = {
  fetchNewAccessToken,
};
