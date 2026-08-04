const axios = require('axios');

const tenantContext = require('../tenancy/tenantContext');
const credentialService = require(
  '../modules/saas/services/credentialService'
);

const {
  NuPayConfigurationError,
  NuPayConnectionError,
  NuPayTimeoutError,
  NuPayInvalidResponseError,
  NuPayProviderError,
  formatCardAcceptor
} = require('../errors/nupayErrors');

const DEFAULT_BASE_URL = 'https://btm.nupay.co.za';

const MANDATE_SUCCESS_CODE = '900000';
const REGISTRATION_SUCCESS_CODE = '500000';

const ACCEPTED_STATUSES = new Set(['Accepted']);
const PENDING_STATUSES = new Set(['Pending Auth']);
const REJECTED_STATUSES = new Set(['Rejected', 'Suspended']);
const UNKNOWN_STATUSES = new Set(['No Response']);

/**
 * Remove wrapping quotes and surrounding whitespace from an environment value.
 */
function normalizeConfigValue(value) {
  return String(value ?? '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

/**
 * Check whether a value is a valid raw NuPay merchant/card-acceptor number.
 */
function isValidCardAcceptor(value) {
  return /^\d{1,15}$/.test(value);
}

/**
 * Safely mask a value for logs.
 */
function maskValue(value) {
  const normalized = normalizeConfigValue(value);

  if (normalized.length < 4) {
    return 'INVALID';
  }

  return `${'*'.repeat(
    Math.max(0, normalized.length - 4)
  )}${normalized.slice(-4)}`;
}

class NuPayService {
  constructor(httpClient = axios) {
    this.httpClient = httpClient;
  }

  /**
   * Resolve tenant credentials first, then safely fall back to environment
   * credentials when tenant values are absent or malformed.
   */
  async getCredentials(tenantId = null) {
    const activeTenantId =
      tenantId || tenantContext.getTenantId();

    let resolved = {
      source: 'env',
      credentials: {},
      mode: 'production'
    };

    if (activeTenantId) {
      resolved = await credentialService.resolve(
        activeTenantId,
        'nupay'
      );
    }

    const creds = resolved?.credentials || {};

    const username = normalizeConfigValue(
      creds.username || process.env.NUPAY_USERNAME
    );

    const password = normalizeConfigValue(
      creds.password || process.env.NUPAY_PASSWORD
    );

    const tenantCardAcceptor = normalizeConfigValue(
      creds.cardAcceptor
    );

    const environmentCardAcceptor = normalizeConfigValue(
      process.env.NUPAY_CARD_ACCEPTOR
    );

    const tenantCardAcceptorValid =
      isValidCardAcceptor(tenantCardAcceptor);

    const environmentCardAcceptorValid =
      isValidCardAcceptor(environmentCardAcceptor);

    let rawCardAcceptor = '';
    let cardAcceptorSource = 'environment';

    if (tenantCardAcceptorValid) {
      rawCardAcceptor = tenantCardAcceptor;
      cardAcceptorSource = 'tenant';
    } else if (environmentCardAcceptorValid) {
      rawCardAcceptor = environmentCardAcceptor;
      cardAcceptorSource = 'environment';
    }

    const baseUrl = normalizeConfigValue(
      creds.baseUrl ||
      creds.apiEndpoint ||
      process.env.NUPAY_BASE_URL ||
      DEFAULT_BASE_URL
    ).replace(/\/+$/, '');

    const integrationEnabled =
      normalizeConfigValue(
        process.env.NUPAY_ENABLED || 'true'
      ).toLowerCase() !== 'false';

    if (!integrationEnabled) {
      throw new NuPayConfigurationError(
        'NuPay integration is disabled'
      );
    }

    if (!username) {
      throw new NuPayConfigurationError(
        'NuPay username is missing'
      );
    }

    if (!password) {
      throw new NuPayConfigurationError(
        'NuPay password is missing'
      );
    }

    if (!rawCardAcceptor) {
      throw new NuPayConfigurationError(
        'NuPay cardAcceptor must contain 1 to 15 digits'
      );
    }

    if (!baseUrl) {
      throw new NuPayConfigurationError(
        'NuPay base URL is missing'
      );
    }

    const formattedCardAcceptor =
      formatCardAcceptor(rawCardAcceptor);

    /*
     * Safe diagnostics only. No usernames, passwords, auth values,
     * or complete merchant numbers are logged.
     *
     * Remove these logs after production verification if not needed.
     */
    if (process.env.NODE_ENV !== 'test') {
      console.log('[NuPay Credential Resolution]', {
        credentialSource: resolved?.source || 'env',
        mode: resolved?.mode || 'production',
        cardAcceptorSource,
        cardAcceptorLength: rawCardAcceptor.length,
        digitsOnly: /^\d+$/.test(rawCardAcceptor),
        maskedCardAcceptor: maskValue(rawCardAcceptor)
      });
    }

    return {
      auth: Buffer.from(
        `${username}:${password}`
      ).toString('base64'),

      cardAcceptor: formattedCardAcceptor,
      baseUrl,

      timeout: Number(
        process.env.NUPAY_TIMEOUT_MS || 15000
      ),

      mode: resolved?.mode || 'production'
    };
  }

  /**
   * Normalize a mandate initiation response.
   *
   * Mandate success uses ResultCode 900000.
   */
  normalizeMandateResponse(data, operation) {
    if (!data || typeof data !== 'object') {
      throw new NuPayInvalidResponseError(
        'NuPay returned a malformed mandate response'
      );
    }

    const status = String(data.Status || '').trim();

    const resultCode = String(
      data.ResultCode || ''
    )
      .replace(/\s+/g, '')
      .trim();

    const references = data.referenceNumbers;

    if (
      !status ||
      !resultCode ||
      !references ||
      typeof references !== 'object'
    ) {
      throw new NuPayInvalidResponseError(
        'NuPay mandate response is missing Status, ResultCode, or referenceNumbers'
      );
    }

    let outcome = 'UNKNOWN';

    if (
      resultCode === MANDATE_SUCCESS_CODE &&
      ACCEPTED_STATUSES.has(status)
    ) {
      outcome = 'ACCEPTED';
    } else if (PENDING_STATUSES.has(status)) {
      outcome = 'PENDING';
    } else if (REJECTED_STATUSES.has(status)) {
      outcome = 'REJECTED';
    } else if (UNKNOWN_STATUSES.has(status)) {
      outcome = 'UNKNOWN';
    } else if (resultCode !== MANDATE_SUCCESS_CODE) {
      outcome = 'REJECTED';
    }

    return {
      outcome,
      operation,
      providerStatus: status,
      resultCode,

      clientReference:
        references.clientReference || '',

      contractReference:
        references.contractReference || '',

      mandateId:
        references.mandateID || '',

      providerTransactionId:
        references.mandateRequestTranId || '',

      providerMessageId:
        references.nedbankMessageId || '',

      channel: data.Channel || '',
      effectiveDate: data.Date || '',
      receivedAt: new Date().toISOString()
    };
  }

  /**
   * Normalize TT1 callback endpoint registration.
   *
   * Important:
   * register_endpoint uses responseCode 500000 for success.
   * It must not be evaluated against mandate code 900000.
   */
  normalizeRegistrationResponse(
    data,
    registrationPayload = {}
  ) {
    if (
      !data ||
      typeof data !== 'object' ||
      data.responseCode === undefined
    ) {
      throw new NuPayInvalidResponseError(
        'NuPay TT1 registration response is malformed'
      );
    }

    const responseCode = String(
      data.responseCode
    )
      .replace(/\s+/g, '')
      .trim();

    const responseMessage = String(
      data.responseMessage ||
      data.message ||
      ''
    ).trim();

    return {
      outcome:
        responseCode === REGISTRATION_SUCCESS_CODE
          ? 'ACCEPTED'
          : 'REJECTED',

      operation: 'registerTT1Endpoint',
      resultCode: responseCode,
      message: responseMessage,

      endpointUrl:
        registrationPayload.endpointUrl || '',

      registrationStatus:
        registrationPayload.registrationStatus || '',

      receivedAt: new Date().toISOString()
    };
  }

  /**
   * Normalize reporting responses.
   */
  normalizeReportResponse(data, operation) {
    if (!data || typeof data !== 'object') {
      throw new NuPayInvalidResponseError(
        'NuPay report response is malformed'
      );
    }

    return {
      outcome: 'ACCEPTED',
      operation,

      pagination: {
        tokenID:
          data.tokenID ||
          data.TokenID ||
          '',

        blockID:
          data.blockID ||
          data.BlockID ||
          ''
      },

      data,
      receivedAt: new Date().toISOString()
    };
  }

  /**
   * Centralized NuPay HTTP request method.
   *
   * Options:
   * - identifierField: `cardAcceptor` for operations or
   *   `merchantNumber` for reports.
   */
  async makeRequest(
    path,
    payload,
    tenantId,
    parser,
    options = {}
  ) {
    const credentials =
      await this.getCredentials(tenantId);

    const identifierField =
      options.identifierField || 'cardAcceptor';

    const body = {
      ...payload,
      auth: credentials.auth
    };

    if (identifierField === 'merchantNumber') {
      delete body.cardAcceptor;

      body.merchantNumber = payload.merchantNumber
        ? formatCardAcceptor(
          String(payload.merchantNumber)
        )
        : credentials.cardAcceptor;
    } else {
      body.cardAcceptor = payload.cardAcceptor
        ? formatCardAcceptor(
          String(payload.cardAcceptor)
        )
        : credentials.cardAcceptor;
    }

    try {
      const response = await this.httpClient.post(
        `${credentials.baseUrl}${path}`,
        body,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: credentials.timeout
        }
      );

      return parser(response.data);
    } catch (error) {
      if (
        error instanceof NuPayConfigurationError ||
        error instanceof NuPayInvalidResponseError ||
        error instanceof NuPayProviderError ||
        error instanceof NuPayTimeoutError ||
        error instanceof NuPayConnectionError
      ) {
        throw error;
      }

      const isTimeout =
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        /timeout/i.test(error.message || '');

      if (isTimeout) {
        throw new NuPayTimeoutError();
      }

      /*
       * Some providers return a valid business rejection payload with a
       * non-2xx HTTP status. Attempt to parse it safely first.
       */
      if (error.response?.data) {
        try {
          return parser(error.response.data);
        } catch (parseError) {
          if (
            parseError instanceof
            NuPayInvalidResponseError
          ) {
            throw parseError;
          }

          throw new NuPayProviderError(
            `NuPay rejected the operation with HTTP ${error.response.status || 'unknown'
            }`,
            422
          );
        }
      }

      throw new NuPayConnectionError(
        'NuPay service communication failed'
      );
    }
  }

  /**
   * Mandate initiation.
   */
  initiateMandate(payload, tenantId = null) {
    return this.makeRequest(
      '/wsDebiCheck/mandate_initiation',
      payload,
      tenantId,
      (data) =>
        this.normalizeMandateResponse(
          data,
          'initiateMandate'
        )
    );
  }

  /**
   * Register or deregister the TT1 callback endpoint.
   */
  registerTT1Endpoint(
    payload = {},
    tenantId = null
  ) {
    const endpointUrl = normalizeConfigValue(
      payload.endpointUrl ||
      process.env.NUPAY_TT1_CALLBACK_URL
    );

    const cardAcceptorEmail =
      normalizeConfigValue(
        payload.cardAcceptorEmail ||
        process.env.NUPAY_CARD_ACCEPTOR_EMAIL
      );

    const registrationStatus =
      normalizeConfigValue(
        payload.registrationStatus || 'Register'
      );

    if (!endpointUrl) {
      throw new NuPayConfigurationError(
        'NuPay TT1 callback URL is missing'
      );
    }

    if (!cardAcceptorEmail) {
      throw new NuPayConfigurationError(
        'NuPay card acceptor email is missing'
      );
    }

    if (
      !['Register', 'Deregister'].includes(
        registrationStatus
      )
    ) {
      throw new NuPayConfigurationError(
        'NuPay TT1 registration status must be Register or Deregister'
      );
    }

    const registrationPayload = {
      endpointUrl,
      cardAcceptorEmail,
      registrationStatus
    };

    return this.makeRequest(
      '/wsDebiCheck/register_endpoint',
      registrationPayload,
      tenantId,
      (data) =>
        this.normalizeRegistrationResponse(
          data,
          registrationPayload
        )
    );
  }

  /**
   * Mandate report.
   */
  getMandateReport(payload, tenantId = null) {
    const reportPayload = {
      ...payload
    };

    delete reportPayload.cardAcceptor;

    return this.makeRequest(
      '/wsDebiCheck/report/mandate_report',
      reportPayload,
      tenantId,
      (data) =>
        this.normalizeReportResponse(
          data,
          'getMandateReport'
        ),
      {
        identifierField: 'merchantNumber'
      }
    );
  }

  /**
   * Instalment report.
   */
  getInstalmentReport(payload, tenantId = null) {
    const reportPayload = {
      ...payload
    };

    delete reportPayload.cardAcceptor;

    return this.makeRequest(
      '/wsDebiCheck/report/instalment_report',
      reportPayload,
      tenantId,
      (data) =>
        this.normalizeReportResponse(
          data,
          'getInstalmentReport'
        ),
      {
        identifierField: 'merchantNumber'
      }
    );
  }
}

const service = new NuPayService();

/*
 * Preserve constructor access for unit tests using:
 * const NuPayService = service.NuPayService;
 */
service.NuPayService = NuPayService;

module.exports = service;