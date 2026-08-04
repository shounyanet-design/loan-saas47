/**
 * NuPay Typed Error Hierarchy & Sanitization Utilities
 */

class NuPayError extends Error {
  constructor(message, code = 'NUPAY_PROVIDER_ERROR', statusCode = 500, retryable = false) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

class NuPayConfigurationError extends NuPayError {
  constructor(message) {
    super(message, 'NUPAY_CONFIG_ERROR', 500, false);
  }
}

class NuPayConnectionError extends NuPayError {
  constructor(message = 'NuPay gateway connection unavailable') {
    super(message, 'NUPAY_CONNECTION_ERROR', 502, true);
  }
}

class NuPayTimeoutError extends NuPayError {
  constructor(message = 'The request timed out before NuPay confirmed the final result. Verify the transaction status before retrying.') {
    super(message, 'NUPAY_RESULT_UNKNOWN', 504, false);
    this.requiresVerification = true;
  }
}

class NuPayInvalidResponseError extends NuPayError {
  constructor(message = 'NuPay gateway returned an invalid or unparseable response') {
    super(message, 'NUPAY_INVALID_RESPONSE', 502, true);
  }
}

class NuPayProviderError extends NuPayError {
  constructor(message = 'NuPay operation rejected by provider', statusCode = 422, code = 'NUPAY_PROVIDER_REJECTION') {
    super(message, code, statusCode, false);
  }
}

class NuPayLocalPersistenceError extends NuPayError {
  constructor(message = 'NuPay confirmed the operation, but the local records could not be updated. Manual reconciliation is required.') {
    super(message, 'NUPAY_LOCAL_PERSISTENCE_FAILED', 500, false);
  }
}

/**
 * Pure validation/formatting helper for NuPay cardAcceptor (Merchant Number).
 * Ensures cardAcceptor is provided as a string, contains 1 to 15 digits, and is left-zero-padded to 15 digits.
 *
 * @param {string} value
 * @returns {string} Exactly 15-digit zero-padded string
 * @throws {NuPayConfigurationError}
 */
function formatCardAcceptor(value) {
  if (typeof value !== 'string') {
    throw new NuPayConfigurationError('NuPay cardAcceptor must be provided as a string');
  }

  const raw = value.trim().replace(/^["']|["']$/g, '');

  if (!raw || !/^\d{1,15}$/.test(raw)) {
    throw new NuPayConfigurationError('NuPay cardAcceptor must contain 1 to 15 digits');
  }

  const formatted = raw.padStart(15, '0');

  if (!/^\d{15}$/.test(formatted)) {
    throw new NuPayConfigurationError('NuPay cardAcceptor must contain exactly 15 digits after formatting');
  }

  return formatted;
}

/**
 * Mask cardAcceptor for safe logging (e.g., "00000255****087").
 * Never prints full merchant number in console logs.
 */
function maskCardAcceptor(value) {
  if (!value) return '[REDACTED]';
  const str = String(value).trim();
  if (str.length <= 4) return '****';
  return str.substring(0, 4) + '*'.repeat(Math.max(0, str.length - 7)) + str.slice(-3);
}

module.exports = {
  NuPayError,
  NuPayConfigurationError,
  NuPayConnectionError,
  NuPayTimeoutError,
  NuPayInvalidResponseError,
  NuPayProviderError,
  NuPayLocalPersistenceError,
  formatCardAcceptor,
  maskCardAcceptor
};
