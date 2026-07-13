/**
 * Datanamix OAuth2 Configuration Settings
 * Structures OAuth flow characteristics such as token expiry buffers and grant types.
 */

const oauthConfig = {
  // Grant type required by Datanamix API (typically 'client_credentials')
  grantType: 'client_credentials',
  
  // Refresh token configuration (if supported by integration)
  autoRefresh: true,
  
  // Buffer in seconds to refresh the token before it officially expires (e.g., 5 minutes)
  expiryBufferSeconds: 300,
  
  // Scope settings for API capability requests (e.g., 'read write verification')
  scope: 'verification',
  
  // In-memory or database token cache configuration
  cache: {
    useMemoryCache: true,
    useDatabaseCache: true,
    cacheKey: 'datanamix_oauth_token'
  }
};

module.exports = oauthConfig;
