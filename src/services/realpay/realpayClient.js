const axios = require('axios');
const realpayAuthService = require('./realpayAuth.service');
const {
  RealPayConfigurationError,
  RealPayConnectionError,
  RealPayTimeoutError,
  RealPayInvalidResponseError,
  RealPayProviderRejectionError,
  RealPayAuthError
} = require('../../errors/realpayErrors');

function isProductionEnvironment(credentials = {}) {
  const env = String(credentials.environment || '').trim().toUpperCase();
  if (env === 'UAT') {
    return false;
  }
  if (env === 'PRODUCTION' || env === 'PROD') {
    return true;
  }
  return String(credentials.mode || '').trim().toLowerCase() === 'production';
}

function getRealPayOrigin(rawUrl) {
  const clean = (rawUrl || 'https://uat.realpaycollect.com:4448').trim().replace(/\/+$/, '');
  return clean.replace(/\/(rpi|rpp|rpt|api_doc|api).*$/i, '').replace(/\/+$/, '');
}

/**
 * RealPay Client
 * Low-level HTTP client handling auth header injection, error mapping, and sanitized response normalization.
 */
class RealPayClient {
  constructor(httpClient = axios) {
    this.httpClient = httpClient;
  }

  /**
   * Execute an HTTP POST request to RealPay API with injected tenant auth token.
   */
  async post(path, payload, tenantId = null, parser = null) {
    const { token, credentials } = await realpayAuthService.getAccessToken(tenantId);

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Merchant-Number': credentials.merchantNumber,
      'X-Product-Code': credentials.product
    };

    const isProd = isProductionEnvironment(credentials);
    const apiPrefix = isProd ? '/rpp/rpws' : '/rpi/rpws';
    const origin = getRealPayOrigin(credentials.baseUrl);
    const url = `${origin}${apiPrefix}${path}`;

    if (process.env.NODE_ENV !== 'test') {
      console.log('[RealPay Request]', {
        path,
        merchantNumber: credentials.merchantNumber,
        product: credentials.product,
        source: credentials.source
      });
    }

    try {
      let response;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          response = await this.httpClient.post(url, payload, {
            headers,
            timeout: credentials.timeout
          });
          break;
        } catch (err) {
          const isDnsOrNetwork = ['EAI_AGAIN', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(err.code);
          if (isDnsOrNetwork && attempt < 3) {
            if (process.env.NODE_ENV !== 'test') {
              console.warn(`[RealPay API Retry] Attempt ${attempt} failed with ${err.code || err.message}, retrying in ${attempt}s...`);
            }
            await new Promise((r) => setTimeout(r, 1000 * attempt));
            continue;
          }
          throw err;
        }
      }

      if (parser) {
        return parser(response.data);
      }
      return response.data;
    } catch (error) {
      if (
        error instanceof RealPayConfigurationError ||
        error instanceof RealPayInvalidResponseError ||
        error instanceof RealPayProviderRejectionError ||
        error instanceof RealPayTimeoutError ||
        error instanceof RealPayConnectionError ||
        error instanceof RealPayAuthError
      ) {
        throw error;
      }

      const isTimeout =
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        /timeout/i.test(error.message || '');

      if (isTimeout) {
        throw new RealPayTimeoutError('RealPay API request timed out');
      }

      if (error.response?.data) {
        if (parser) {
          try {
            return parser(error.response.data);
          } catch {
            // Parser threw on rejection response, continue with provider error
          }
        }
        throw new RealPayProviderRejectionError(
          error.response.data.message || error.response.data.statusDescription || 'RealPay request rejected',
          error.response.status,
          error.response.data
        );
      }

      throw new RealPayConnectionError(`Failed to communicate with RealPay: ${error.message}`);
    }
  }

  /**
   * Execute an HTTP GET request to RealPay API.
   */
  async get(path, params = {}, tenantId = null, parser = null) {
    const { token, credentials } = await realpayAuthService.getAccessToken(tenantId);

    const headers = {
      'Authorization': `Bearer ${token}`,
      'X-Merchant-Number': credentials.merchantNumber
    };

    const isProd = credentials.environment === 'PRODUCTION' || credentials.mode === 'production';
    const apiPrefix = isProd ? '/rpp/rpws' : '/rpi/rpws';
    const origin = getRealPayOrigin(credentials.baseUrl);
    const url = `${origin}${apiPrefix}${path}`;

    try {
      const response = await this.httpClient.get(url, {
        headers,
        params,
        timeout: credentials.timeout
      });

      if (parser) {
        return parser(response.data);
      }
      return response.data;
    } catch (error) {
      const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || /timeout/i.test(error.message || '');
      if (isTimeout) throw new RealPayTimeoutError('RealPay enquiry request timed out');
      throw new RealPayConnectionError(`Failed to query RealPay: ${error.message}`);
    }
  }
}

module.exports = new RealPayClient();
