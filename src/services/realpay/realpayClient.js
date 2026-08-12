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

    const isProd = credentials.environment === 'PRODUCTION' || credentials.mode === 'production';
    const apiPrefix = isProd ? '/rpp/rpws' : '/rpi/rpws';
    const base = credentials.baseUrl.replace(/\/+$/, '');
    const fullBase = (base.includes('/rpi/rpws') || base.includes('/rpp/rpws')) ? base : `${base}${apiPrefix}`;
    const url = `${fullBase}${path}`;

    if (process.env.NODE_ENV !== 'test') {
      console.log('[RealPay Request]', {
        path,
        merchantNumber: credentials.merchantNumber,
        product: credentials.product,
        source: credentials.source
      });
    }

    try {
      const response = await this.httpClient.post(url, payload, {
        headers,
        timeout: credentials.timeout
      });

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
    const base = credentials.baseUrl.replace(/\/+$/, '');
    const fullBase = (base.includes('/rpi/rpws') || base.includes('/rpp/rpws')) ? base : `${base}${apiPrefix}`;
    const url = `${fullBase}${path}`;

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
