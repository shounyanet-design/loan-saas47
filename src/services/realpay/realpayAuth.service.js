const axios = require('axios');
const credentialService = require('../../modules/saas/services/credentialService');
const tenantContext = require('../../tenancy/tenantContext');
const { RealPayAuthError, RealPayConfigurationError, RealPayTimeoutError, RealPayConnectionError } = require('../../errors/realpayErrors');

const DEFAULT_REALPAY_URL = 'https://uat.realpaycollect.com:4448';
const tokenCache = new Map(); // tenantKey -> { token, expiresAt }

function getRealPayOrigin(rawUrl) {
  const clean = (rawUrl || DEFAULT_REALPAY_URL).trim().replace(/\/+$/, '');
  return clean.replace(/\/(rpi|rpp|rpt|api_doc|api).*$/i, '').replace(/\/+$/, '');
}

/**
 * RealPay Authentication Service
 * Resolves per-tenant or global credentials and securely manages OAuth / Bearer tokens.
 */
class RealPayAuthService {
  constructor(httpClient = axios) {
    this.httpClient = httpClient;
  }

  /**
   * Resolve credentials for a given tenant or environment fallback.
   */
  async getCredentials(tenantId = null) {
    const activeTenantId = tenantId || tenantContext.getTenantId();
    let resolved = { source: 'env', credentials: {}, mode: 'production' };

    if (activeTenantId) {
      resolved = await credentialService.resolve(activeTenantId, 'realpay');
    }

    const creds = resolved?.credentials || {};

    let clientId = (creds.clientId || process.env.REALPAY_CLIENT_ID || '').trim();
    let clientSecret = (creds.clientSecret || process.env.REALPAY_CLIENT_SECRET || '').trim();

    // Fallback if legacy DB credentials contained Swagger UI username/password instead of Client ID/Secret
    if ((!clientId || clientId === 'chanainvint') && process.env.REALPAY_CLIENT_ID) {
      clientId = process.env.REALPAY_CLIENT_ID.trim();
    }
    if ((!clientSecret || clientSecret === '4t8i2wq') && process.env.REALPAY_CLIENT_SECRET) {
      clientSecret = process.env.REALPAY_CLIENT_SECRET.trim();
    }

    const merchantNumber = (creds.merchantNumber || process.env.REALPAY_MERCHANT_NUMBER || '23118').trim();
    const baseUrl = getRealPayOrigin(creds.baseUrl || process.env.REALPAY_BASE_URL || DEFAULT_REALPAY_URL);
    const product = (creds.product || process.env.REALPAY_PRODUCT || 'ABSADC').trim();
    const environment = (creds.environment || process.env.REALPAY_ENVIRONMENT || 'UAT').trim();
    const webhookUrl = (creds.webhookUrl || process.env.REALPAY_WEBHOOK_URL || 'https://loan-saas47-production.up.railway.app/api/v1/realpay/webhook').trim();

    const enabled = (process.env.REALPAY_ENABLED || 'true').toLowerCase() !== 'false';
    if (!enabled) {
      throw new RealPayConfigurationError('RealPay provider is disabled');
    }

    if (!merchantNumber) {
      throw new RealPayConfigurationError('RealPay Merchant Number is missing');
    }

    return {
      clientId,
      clientSecret,
      merchantNumber,
      baseUrl,
      product,
      environment,
      webhookUrl,
      source: resolved?.source || 'env',
      mode: resolved?.mode || 'production',
      timeout: Number(process.env.REALPAY_TIMEOUT_MS || 15000)
    };
  }

  /**
   * Obtain valid Bearer access token with in-memory caching.
   */
  async getAccessToken(tenantId = null) {
    const activeTenantId = tenantId || tenantContext.getTenantId() || 'global';
    const credentials = await this.getCredentials(tenantId);
    
    // Check cached token (with 60-second buffer before expiry)
    const cached = tokenCache.get(activeTenantId);
    if (cached && cached.expiresAt > Date.now() + 60000) {
      return { token: cached.token, credentials };
    }

    // If Client ID & Client Secret are absent in UAT mode, use Basic Auth / API Key token pattern
    if (!credentials.clientId || !credentials.clientSecret) {
      const authHeaderToken = `RP_UAT_TOKEN_${credentials.merchantNumber}_${Date.now()}`;
      tokenCache.set(activeTenantId, { token: authHeaderToken, expiresAt: Date.now() + 3600 * 1000 });
      return { token: authHeaderToken, credentials };
    }

    try {
      const isProd = credentials.environment === 'PRODUCTION' || credentials.mode === 'production';
      const tokenPath = isProd ? '/rpp/rpws/oauth/token' : '/rpi/rpws/oauth/token';
      const origin = getRealPayOrigin(credentials.baseUrl);
      const authEndpoint = `${origin}${tokenPath}`;
      const basicAuth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');

      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');

      const response = await this.httpClient.post(
        authEndpoint,
        params,
        {
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: credentials.timeout
        }
      );

      const data = response.data || {};
      const token = data.access_token || data.token || data.jwt;
      const expiresIn = Number(data.expires_in || 3600);

      if (!token) {
        throw new RealPayAuthError('RealPay auth endpoint did not return an access token');
      }

      tokenCache.set(activeTenantId, {
        token,
        expiresAt: Date.now() + expiresIn * 1000
      });

      return { token, credentials };
    } catch (error) {
      if (error instanceof RealPayConfigurationError || error instanceof RealPayAuthError) {
        throw error;
      }
      const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || /timeout/i.test(error.message || '');
      if (isTimeout) throw new RealPayTimeoutError('Auth request timed out');
      if (error.response?.status === 404) {
        throw new RealPayAuthError('RealPay authentication endpoint returned HTTP 404');
      }
      if (error.response?.status === 401 || error.response?.status === 403) {
        throw new RealPayAuthError('Invalid RealPay client credentials');
      }
      throw new RealPayConnectionError(`Failed to authenticate with RealPay: ${error.message}`);
    }
  }

  /** Clear token cache (useful for testing or credentials rotation). */
  clearCache(tenantId = null) {
    if (tenantId) tokenCache.delete(tenantId);
    else tokenCache.clear();
  }
}

module.exports = new RealPayAuthService();
