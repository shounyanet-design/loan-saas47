/**
 * Datanamix Integration Error Handler
 * Standardizes API communication errors, validation errors, and authentication failures.
 */

class DatanamixError extends Error {
  constructor(message, statusCode, errorCode, details = null) {
    super(message);
    this.name = 'DatanamixError';
    this.statusCode = statusCode || 500;
    this.errorCode = errorCode || 'DATANAMIX_INTEGRATION_ERROR';
    this.details = details;
    this.timestamp = new Date();
  }
}

/**
 * Parses raw Axios/HTTP errors and maps them to structured enterprise DatanamixErrors
 * @param {Error} error - The original caught error object
 * @returns {DatanamixError} The standardized error object
 */
const handleIntegrationError = (error) => {
  console.error('❌ [Datanamix Integration Error]:', {
    message: error.message,
    response: error.response ? {
      status: error.response.status,
      data: error.response.data
    } : 'No Response'
  });

  if (error.response) {
    const status = error.response.status;
    const responseData = error.response.data || {};
    const message = responseData.message || responseData.error_description || error.message;
    
    switch (status) {
      case 400:
        return new DatanamixError(
          `Validation Failed: ${message}`,
          400,
          'DATANAMIX_VALIDATION_ERROR',
          responseData
        );
      case 401:
        return new DatanamixError(
          `Unauthorized: Please verify Datanamix Client ID and Secret. Details: ${message}`,
          401,
          'DATANAMIX_AUTH_ERROR',
          responseData
        );
      case 403:
        return new DatanamixError(
          `Forbidden: Insufficient permissions for this verification feature. Details: ${message}`,
          403,
          'DATANAMIX_FORBIDDEN_ERROR',
          responseData
        );
      case 404:
        return new DatanamixError(
          `Not Found: Resource or verification endpoint could not be found. Details: ${message}`,
          404,
          'DATANAMIX_ENDPOINT_NOT_FOUND',
          responseData
        );
      case 429:
        return new DatanamixError(
          `Rate Limited: Datanamix API rate limits exceeded. Retry after buffer.`,
          429,
          'DATANAMIX_RATE_LIMIT_ERROR',
          responseData
        );
      default:
        return new DatanamixError(
          `Datanamix Remote Server Error: ${message}`,
          status,
          'DATANAMIX_SERVER_ERROR',
          responseData
        );
    }
  }

  // Network / timeout errors
  if (error.request) {
    return new DatanamixError(
      'Network Connection Error: No response received from Datanamix API gateways.',
      503,
      'DATANAMIX_GATEWAY_TIMEOUT',
      error.message
    );
  }

  return new DatanamixError(
    `Datanamix Configuration/Internal Error: ${error.message}`,
    500,
    'DATANAMIX_INTERNAL_ERROR'
  );
};

module.exports = {
  DatanamixError,
  handleIntegrationError
};
