/**
 * Typed errors for RealPay Integration
 */

class RealPayError extends Error {
  constructor(message, code = 'REALPAY_ERROR', statusCode = 500, requiresVerification = false) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.requiresVerification = requiresVerification;
    Error.captureStackTrace(this, this.constructor);
  }
}

class RealPayConfigurationError extends RealPayError {
  constructor(message = 'RealPay configuration error') {
    super(message, 'REALPAY_CONFIG_ERROR', 400);
  }
}

class RealPayAuthError extends RealPayError {
  constructor(message = 'RealPay authentication failed') {
    super(message, 'REALPAY_AUTH_ERROR', 502);
  }
}

class RealPayProviderRejectionError extends RealPayError {
  constructor(message = 'RealPay rejected request', statusCode = 422, details = null) {
    super(message, 'REALPAY_PROVIDER_REJECTION', statusCode);
    this.details = details;
  }
}

class RealPayTimeoutError extends RealPayError {
  constructor(message = 'RealPay request timed out; status unknown') {
    super(message, 'REALPAY_TIMEOUT', 504, true);
  }
}

class RealPayConnectionError extends RealPayError {
  constructor(message = 'Failed to connect to RealPay service') {
    super(message, 'REALPAY_CONNECTION_ERROR', 502);
  }
}

class RealPayInvalidResponseError extends RealPayError {
  constructor(message = 'RealPay returned invalid response format') {
    super(message, 'REALPAY_INVALID_RESPONSE', 502);
  }
}

class RealPayResultUnknownError extends RealPayError {
  constructor(message = 'Transaction outcome is unknown and requires manual verification') {
    super(message, 'REALPAY_RESULT_UNKNOWN', 202, true);
  }
}

class RealPayLocalPersistenceFailedError extends RealPayError {
  constructor(message = 'RealPay transaction succeeded remotely but failed local persistence') {
    super(message, 'REALPAY_LOCAL_PERSISTENCE_FAILED', 500);
  }
}

class RealPaySimulationNotAllowedError extends RealPayError {
  constructor(message = 'RealPay simulation is strictly disabled in PRODUCTION environment') {
    super(message, 'REALPAY_SIMULATION_NOT_ALLOWED', 403);
  }
}

module.exports = {
  RealPayError,
  RealPayConfigurationError,
  RealPayAuthError,
  RealPayProviderRejectionError,
  RealPayTimeoutError,
  RealPayConnectionError,
  RealPayInvalidResponseError,
  RealPayResultUnknownError,
  RealPayLocalPersistenceFailedError,
  RealPaySimulationNotAllowedError
};
