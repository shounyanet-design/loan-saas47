const axios = require('axios');
const { getAccessToken, refreshToken } = require('./datanamixAuth.service');
const tenantContext = require('../../tenancy/tenantContext');
const credentialService = require('../../modules/saas/services/credentialService');

const DEFAULT_BASE_URL = (process.env.DATANAMIX_BASE_URL || 'https://api.datanamix.com').replace(/\/$/, '');

// ─── Axios instance ───────────────────────────────────────────────────────────
const datanamixAxiosClient = axios.create({
  baseURL: DEFAULT_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// ─── Request interceptor — inject Bearer token automatically ─────────────────
datanamixAxiosClient.interceptors.request.use(
  async (config) => {
    const tenantId = tenantContext.getTenantId();
    
    // Resolve dynamic Base URL if tenant settings exist
    if (tenantId) {
      const resolved = await credentialService.resolve(tenantId, 'datanamix');
      if (resolved && resolved.source === 'tenant') {
        const creds = resolved.credentials || {};
        if (creds.baseUrl) {
          try {
            config.baseURL = new URL(creds.baseUrl).origin;
          } catch (e) {
            config.baseURL = creds.baseUrl.replace(/\/$/, '');
          }
        }
      }
    } else {
      config.baseURL = DEFAULT_BASE_URL;
    }

    const token = await getAccessToken(tenantId);
    config.headers['Authorization'] = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response interceptor — handle 401/403/TOKEN_EXPIRED with auto-retry ─────
datanamixAxiosClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    const status = error.response?.status;
    const errorCode =
      error.response?.data?.error_code ||
      error.response?.data?.code ||
      error.response?.data?.error;

    const isAuthError =
      status === 401 ||
      status === 403 ||
      errorCode === 'TOKEN_EXPIRED' ||
      errorCode === 'UNAUTHORIZED';

    if (isAuthError && !originalRequest._retried) {
      originalRequest._retried = true;
      const tenantId = tenantContext.getTenantId();

      try {
        console.log(
          '[Datanamix Client] Auth error detected — refreshing token and retrying request...'
        );
        const newToken = await refreshToken(tenantId);
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
        return datanamixAxiosClient(originalRequest);
      } catch (refreshError) {
        console.error(
          '[Datanamix Client] Token refresh failed during retry:',
          refreshError.message
        );
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

module.exports = datanamixAxiosClient;
