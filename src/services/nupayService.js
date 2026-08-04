const axios = require('axios');
const tenantContext = require('../tenancy/tenantContext');
const credentialService = require('../modules/saas/services/credentialService');
const {
  NuPayConfigurationError,
  NuPayConnectionError,
  NuPayTimeoutError,
  NuPayInvalidResponseError,
  NuPayProviderError,
  formatCardAcceptor
} = require('../errors/nupayErrors');

const DEFAULT_BASE_URL = 'https://btm.nupay.co.za';
const FINAL_SUCCESS_CODE = '900000';
const ACCEPTED_STATUSES = new Set(['Accepted']);
const PENDING_STATUSES = new Set(['Pending Auth']);
const REJECTED_STATUSES = new Set(['Rejected', 'Suspended']);
const UNKNOWN_STATUSES = new Set(['No Response']);

class NuPayService {
  constructor(httpClient = axios) {
    this.httpClient = httpClient;
  }

  async getCredentials(tenantId) {
    const activeTenantId = tenantId || tenantContext.getTenantId();
    let resolved = { source: 'env', credentials: {}, mode: 'production' };

    if (activeTenantId) {
      resolved = await credentialService.resolve(activeTenantId, 'nupay');
    }

    console.log('[NuPay Resolved Credentials]', {
      source: resolved.source,
      mode: resolved.mode,
      credentialKeys: Object.keys(resolved.credentials || {})
    });

    const creds = resolved.credentials || {};
    const username = creds.username || process.env.NUPAY_USERNAME;
    const password = creds.password || process.env.NUPAY_PASSWORD;

    const tenantValue = creds.cardAcceptor;
    const envValue = process.env.NUPAY_CARD_ACCEPTOR;

    const tenantNormalized = String(tenantValue ?? '').trim().replace(/^["']|["']$/g, '');
    const envNormalized = String(envValue ?? '').trim().replace(/^["']|["']$/g, '');

    const tenantValid = /^\d{1,15}$/.test(tenantNormalized);
    const envValid = /^\d{1,15}$/.test(envNormalized);

    let rawCardAcceptor = '';
    let selectedSource = 'environment';

    if (tenantValid) {
      rawCardAcceptor = tenantNormalized;
      selectedSource = 'tenant';
    } else if (envValid) {
      rawCardAcceptor = envNormalized;
      selectedSource = 'environment';
    }

    const raw = rawCardAcceptor;
    const normalized = String(raw ?? '').trim().replace(/^["']|["']$/g, '');

    console.log('[NuPay Card Acceptor Diagnostic]', {
      credentialSource: selectedSource,
      rawType: typeof raw,
      normalizedLength: normalized.length,
      digitsOnly: /^\d+$/.test(normalized),
      hasLeadingOrTrailingWhitespace: String(raw ?? '') !== normalized,
      masked:
        normalized.length >= 4
          ? `${'*'.repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}`
          : 'INVALID'
    });

    if (!rawCardAcceptor) {
      throw new NuPayConfigurationError('NuPay cardAcceptor must contain 1 to 15 digits');
    }

    const baseUrl = (creds.baseUrl || creds.apiEndpoint || process.env.NUPAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

    if (!username || !String(username).trim()) {
      throw new NuPayConfigurationError('NuPay username is missing');
    }
    if (!password || !String(password).trim()) {
      throw new NuPayConfigurationError('NuPay password is missing');
    }
    if (String(process.env.NUPAY_ENABLED || 'true').toLowerCase() === 'false') {
      throw new NuPayConfigurationError('NuPay integration is disabled');
    }

    return {
      auth: Buffer.from(`${String(username).trim()}:${String(password).trim()}`).toString('base64'),
      cardAcceptor: formatCardAcceptor(rawCardAcceptor),
      baseUrl,
      timeout: Number(process.env.NUPAY_TIMEOUT_MS || 15000),
      mode: resolved.mode || 'production'
    };
  }

  normalizeMandateResponse(data, operation) {
    if (!data || typeof data !== 'object') {
      throw new NuPayInvalidResponseError('NuPay returned a malformed response');
    }

    const status = data.Status;
    const resultCode = data.ResultCode ? String(data.ResultCode).replace(/\s+/g, '') : '';
    const refs = data.referenceNumbers;

    if (!status || !resultCode || !refs || typeof refs !== 'object') {
      throw new NuPayInvalidResponseError('NuPay mandate response is missing Status, ResultCode, or referenceNumbers');
    }

    let outcome = 'UNKNOWN';
    if (resultCode === FINAL_SUCCESS_CODE && ACCEPTED_STATUSES.has(status)) outcome = 'ACCEPTED';
    else if (PENDING_STATUSES.has(status)) outcome = 'PENDING';
    else if (REJECTED_STATUSES.has(status)) outcome = 'REJECTED';
    else if (UNKNOWN_STATUSES.has(status)) outcome = 'UNKNOWN';
    else if (resultCode !== FINAL_SUCCESS_CODE) outcome = 'REJECTED';

    return {
      outcome,
      operation,
      providerStatus: status,
      resultCode,
      clientReference: refs.clientReference || '',
      contractReference: refs.contractReference || '',
      mandateId: refs.mandateID || '',
      providerTransactionId: refs.mandateRequestTranId || '',
      providerMessageId: refs.nedbankMessageId || '',
      channel: data.Channel || '',
      effectiveDate: data.Date || '',
      receivedAt: new Date().toISOString()
    };
  }

  normalizeRegistrationResponse(data, payload = {}) {
    if (!data || typeof data !== 'object' || data.responseCode === undefined) {
      throw new NuPayInvalidResponseError('NuPay TT1 registration response is malformed');
    }
    const responseCode = String(data.responseCode).replace(/\s+/g, '');
    return {
      outcome: responseCode === FINAL_SUCCESS_CODE ? 'ACCEPTED' : 'REJECTED',
      operation: 'registerTT1Endpoint',
      resultCode: responseCode,
      message: data.responseMessage || data.message || '',
      endpointUrl: payload.endpointUrl || '',
      registrationStatus: payload.registrationStatus || '',
      receivedAt: new Date().toISOString()
    };
  }

  normalizeReportResponse(data, operation) {
    if (!data || typeof data !== 'object') {
      throw new NuPayInvalidResponseError('NuPay report response is malformed');
    }
    return {
      outcome: 'ACCEPTED',
      operation,
      pagination: {
        tokenID: data.tokenID || data.TokenID || '',
        blockID: data.blockID || data.BlockID || ''
      },
      data,
      receivedAt: new Date().toISOString()
    };
  }

  async makeRequest(path, payload, tenantId, parser) {
    const credentials = await this.getCredentials(tenantId);
    const body = {
      ...payload,
      auth: credentials.auth,
      cardAcceptor: payload.cardAcceptor
        ? formatCardAcceptor(String(payload.cardAcceptor))
        : credentials.cardAcceptor
    };

    try {
      const response = await this.httpClient.post(`${credentials.baseUrl}${path}`, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: credentials.timeout
      });
      return parser(response.data);
    } catch (error) {
      if (error instanceof NuPayConfigurationError || error instanceof NuPayInvalidResponseError) throw error;

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || /timeout/i.test(error.message || '')) {
        throw new NuPayTimeoutError();
      }

      if (error.response && error.response.data) {
        try {
          return parser(error.response.data);
        } catch {
          throw new NuPayProviderError(`NuPay rejected the operation with HTTP ${error.response.status}`, 422);
        }
      }

      throw new NuPayConnectionError('NuPay service communication failed');
    }
  }

  initiateMandate(payload, tenantId = null) {
    return this.makeRequest(
      '/wsDebiCheck/mandate_initiation',
      payload,
      tenantId,
      (data) => this.normalizeMandateResponse(data, 'initiateMandate')
    );
  }

  registerTT1Endpoint(payload = {}, tenantId = null) {
    const endpointUrl = payload.endpointUrl || process.env.NUPAY_TT1_CALLBACK_URL;
    const cardAcceptorEmail = payload.cardAcceptorEmail || process.env.NUPAY_CARD_ACCEPTOR_EMAIL;
    const registrationStatus = payload.registrationStatus || 'Register';

    if (!endpointUrl) {
      throw new NuPayConfigurationError('NuPay TT1 callback URL is missing');
    }
    if (!cardAcceptorEmail) {
      throw new NuPayConfigurationError('NuPay card acceptor email is missing');
    }

    const fullPayload = {
      ...payload,
      endpointUrl,
      cardAcceptorEmail,
      registrationStatus
    };

    return this.makeRequest(
      '/wsDebiCheck/register_endpoint',
      fullPayload,
      tenantId,
      (data) => this.normalizeRegistrationResponse(data, fullPayload)
    );
  }

  getMandateReport(payload, tenantId = null) {
    const reportPayload = { ...payload, merchantNumber: payload.merchantNumber || payload.cardAcceptor };
    delete reportPayload.cardAcceptor;
    return this.makeRequest(
      '/wsDebiCheck/report/mandate_report',
      reportPayload,
      tenantId,
      (data) => this.normalizeReportResponse(data, 'getMandateReport')
    );
  }

  getInstalmentReport(payload, tenantId = null) {
    const reportPayload = { ...payload, merchantNumber: payload.merchantNumber || payload.cardAcceptor };
    delete reportPayload.cardAcceptor;
    return this.makeRequest(
      '/wsDebiCheck/report/instalment_report',
      reportPayload,
      tenantId,
      (data) => this.normalizeReportResponse(data, 'getInstalmentReport')
    );
  }
}

const service = new NuPayService();
service.NuPayService = NuPayService;

module.exports = service;
