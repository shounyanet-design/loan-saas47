/**
 * Datanamix HTTP Request Handler
 * Executes API requests using axios. Authorization headers are injected
 * by the caller (datanamixClient.js) before reaching here.
 */

const axios = require('axios');
const { handleIntegrationError } = require('./errorHandler');
const datanamixConfig = require('../../../config/datanamix.config');

/**
 * Executes an authenticated HTTP request to a Datanamix endpoint.
 * @param {Object} options - { url, method, headers, data, params }
 * @returns {Promise<Object>} Parsed JSON response body
 */
const executeRequest = async (options = {}) => {
  const {
    url,
    method = 'GET',
    data = null,
    headers = {},
    params = null,
  } = options;

  console.log(`[Datanamix] ${method} → ${url}`);

  const requestHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...headers,
  };

  try {
    const response = await axios.request({
      url,
      method,
      data,
      headers: requestHeaders,
      params,
      timeout: datanamixConfig.requestTimeout || 30000,
    });

    return response.data;
  } catch (error) {
    throw handleIntegrationError(error);
  }
};

module.exports = {
  executeRequest,
};
