const axios = require('axios');
const tenantContext = require('../../tenancy/tenantContext');
const credentialService = require('../../modules/saas/services/credentialService');

// ─── In-memory token state cached per tenant ──────────────────────────────────
// Maps tenantId -> { accessToken, tokenExpiry, lastExpiresIn }
const tokenCache = new Map();

const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── loginToDatanamix (OAuth2 Client Credentials per tenant) ──────────────────
const loginToDatanamix = async (tenantId) => {
  let clientId = process.env.DATANAMIX_CLIENT_ID;
  let clientSecret = process.env.DATANAMIX_CLIENT_SECRET;
  let baseUrl = (process.env.DATANAMIX_BASE_URL || 'https://api.datanamix.com').replace(/\/$/, '');

  const activeTenantId = tenantId || tenantContext.getTenantId();
  if (activeTenantId && activeTenantId !== 'global') {
    const resolved = await credentialService.resolve(activeTenantId, 'datanamix');
    if (resolved && resolved.source === 'tenant') {
      const creds = resolved.credentials || {};
      clientId = creds.clientId || clientId;
      clientSecret = creds.clientSecret || clientSecret;
      baseUrl = (creds.baseUrl || baseUrl).replace(/\/$/, '');
    } else if (process.env.NODE_ENV === 'production' && resolved.source === 'env') {
      throw new Error('Datanamix credentials are not configured for this tenant in production.');
    }
  }

  if (!clientId || !clientSecret) {
    throw new Error(
      'DATANAMIX_CLIENT_ID and DATANAMIX_CLIENT_SECRET must be set in .env or tenant settings'
    );
  }

  const tokenUrl = `${baseUrl}/v1/oauth/token`;

  const response = await axios.post(
    tokenUrl,
    {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    },
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 15000,
    }
  );

  const { access_token, expires_in = 14399 } = response.data;

  if (!access_token) {
    throw new Error('Datanamix OAuth response did not contain an access_token');
  }

  return { access_token, expires_in };
};

// ─── refreshToken ─────────────────────────────────────────────────────────────
const refreshToken = async (tenantId) => {
  const activeTenantId = tenantId || tenantContext.getTenantId() || 'global';
  try {
    const { access_token, expires_in } = await loginToDatanamix(activeTenantId);
    
    // Refresh 60 seconds before actual expiry
    const expiryTime = Date.now() + (expires_in - 60) * 1000;
    tokenCache.set(activeTenantId, {
      accessToken: access_token,
      tokenExpiry: expiryTime,
      lastExpiresIn: expires_in
    });
    
    return access_token;
  } catch (error) {
    throw error;
  }
};

// ─── getAccessToken ───────────────────────────────────────────────────────────
const getAccessToken = async (tenantId) => {
  const activeTenantId = tenantId || tenantContext.getTenantId() || 'global';
  const cached = tokenCache.get(activeTenantId);
  const isExpired = !cached || Date.now() >= cached.tokenExpiry;

  if (cached && cached.accessToken && !isExpired) {
    return cached.accessToken;
  }
  return refreshToken(activeTenantId);
};

// ─── initializeDatanamixAuth ──────────────────────────────────────────────────
const initializeDatanamixAuth = async () => {
  let attempts = 0;

  while (attempts < RETRY_COUNT) {
    try {
      console.log(`[Datanamix] Global authentication attempt ${attempts + 1}/${RETRY_COUNT}...`);
      await refreshToken('global');
      console.log('[Datanamix] Global authentication successful');
      return;
    } catch (error) {
      attempts++;
      console.error(`[Datanamix] OAuth authentication failed: ${error.message}`);

      if (attempts < RETRY_COUNT) {
        console.log(`[Datanamix] Retrying authentication in ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  console.error(
    '[Datanamix] Authentication failed after all retries. APIs will auto-retry on first call.'
  );
};

module.exports = {
  loginToDatanamix,
  getAccessToken,
  refreshToken,
  initializeDatanamixAuth,
};
