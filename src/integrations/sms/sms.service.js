const axios = require('axios');
const SmsLog = require('../../models/SmsLog');
const tenantContext = require('../../tenancy/tenantContext');
const credentialService = require('../../modules/saas/services/credentialService');

/**
 * Normalizes a phone number to strict E.164-like digit-only format.
 * - South African numbers become: 278xxxxxxxx (no leading +, 00, or spaces).
 * - Other international numbers are cleaned of non-digits.
 * 
 * @param {string} phoneNumber 
 * @returns {string} Cleaned phone number
 */
const normalizePhoneNumber = (phoneNumber) => {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    throw new Error('INVALID_NUMBER');
  }

  // Remove spaces, dashes, parentheses, and leading plus sign
  let cleaned = phoneNumber.replace(/[\s\-\(\)\+]/g, '');

  // Remove leading double-zeros (e.g. 00278...)
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }

  // Handle local SA format starting with 0 (e.g. 082...)
  if (cleaned.startsWith('0')) {
    cleaned = '27' + cleaned.substring(1);
  }

  // Validate that the normalized number consists only of digits and is of reasonable length
  if (!/^\d{9,15}$/.test(cleaned)) {
    throw new Error('INVALID_NUMBER');
  }

  return cleaned;
};

/**
 * Maps gateway/http errors to readable error codes.
 * 
 * @param {Error} error 
 * @returns {string} Error code
 */
const classifyError = (error) => {
  if (error.message === 'INVALID_NUMBER') {
    return 'INVALID_NUMBER';
  }

  if (error.response) {
    const status = error.response.status;
    const responseData = error.response.data;

    // Convert data to string if object to search for error details
    const dataStr = typeof responseData === 'object' ? JSON.stringify(responseData) : String(responseData);

    if (status === 401) {
      return 'AUTH_FAILED';
    }
    if (status === 403 || dataStr.toLowerCase().includes('credit') || dataStr.toLowerCase().includes('balance')) {
      return 'INSUFFICIENT_CREDITS';
    }
    if (status === 429) {
      return 'RATE_LIMIT';
    }
    if (dataStr.toLowerCase().includes('sender') || dataStr.toLowerCase().includes('from')) {
      return 'INVALID_SENDER';
    }
    if (status === 400 || status === 404 || dataStr.toLowerCase().includes('number') || dataStr.toLowerCase().includes('recipient')) {
      return 'INVALID_NUMBER';
    }
    return 'NOT_SENT';
  }

  if (error.request) {
    return 'NETWORK_ERROR';
  }

  return 'NOT_SENT';
};

/**
 * Sends an OTP SMS using the BulkSMS API with retries, E.164 normalization, test mode, and DB logging.
 * 
 * @param {string} phoneNumber - The recipient's phone number
 * @param {string} otpCode - The 6-digit OTP code to send
 * @param {string} agreementNumber - Optional agreement number for context
 * @returns {Promise<Object>} API response data
 */
const sendOtpSms = async (phoneNumber, otpCode, agreementNumber) => {
  // 1. Normalize Phone Number
  let formattedPhone;
  try {
    formattedPhone = normalizePhoneNumber(phoneNumber);
  } catch (normError) {
    console.error(`[BulkSMS] Normalization failed for ${phoneNumber}:`, normError.message);
    
    // Log normalization failure to database
    await SmsLog.create({
      phoneNumber: phoneNumber,
      message: `OTP Code: ${otpCode} (Agreement: ${agreementNumber || 'N/A'})`,
      provider: 'BulkSMS',
      status: 'FAILED',
      errorMessage: 'INVALID_NUMBER'
    }).catch(dbErr => console.error('[BulkSMS] Failed to write failure log to DB:', dbErr.message));

    throw new Error('INVALID_NUMBER');
  }

  const messageText = `Your Point.47 digital agreement ${agreementNumber ? `(${agreementNumber}) ` : ''}OTP is: ${otpCode}. It is valid for ${process.env.OTP_EXPIRY_MINUTES || 5} minutes. Do not share this code with anyone.`;

  // 2. Test Mode Handling
  if (process.env.SMS_TEST_MODE === 'true') {
    console.log('====================================');
    console.log('[BulkSMS TEST MODE] SMS Dispatch Intercepted');
    console.log(`Recipient: ${formattedPhone}`);
    console.log(`OTP:       ${otpCode}`);
    console.log(`Message:   ${messageText}`);
    console.log('====================================');

    // Log to DB
    const log = await SmsLog.create({
      phoneNumber: formattedPhone,
      message: messageText,
      provider: 'BulkSMS',
      status: 'TEST_MODE',
      requestPayload: { to: formattedPhone, body: messageText },
      responsePayload: { testMode: true }
    }).catch(dbErr => console.error('[BulkSMS] Failed to write test log to DB:', dbErr.message));

    return { success: true, data: { testMode: true }, logId: log ? log._id : null };
  }

  // 3. Environment Variables Validation
  let baseUrl = process.env.BULKSMS_BASE_URL || 'https://api.bulksms.com/v1';
  let authToken = process.env.SMS_AUTH_TOKEN;
  let authMethod = 'Basic Auth (Pre-constructed)';

  const tenantId = tenantContext.getTenantId();
  if (tenantId) {
    const resolved = await credentialService.resolve(tenantId, 'bulksms');
    if (resolved && resolved.source === 'tenant') {
      const creds = resolved.credentials || {};
      baseUrl = creds.baseUrl || baseUrl;
      if (creds.token) {
        authToken = creds.token;
        authMethod = 'Tenant BulkSMS Token';
      } else if (creds.tokenId && creds.tokenSecret) {
        const rawCreds = `${creds.tokenId}:${creds.tokenSecret}`;
        const base64Creds = Buffer.from(rawCreds).toString('base64');
        authToken = `Basic ${base64Creds}`;
        authMethod = 'Tenant Token ID + Token Secret (Dynamic)';
      }
    } else if (process.env.NODE_ENV === 'production' && resolved.source === 'env') {
      throw new Error('BulkSMS credentials are not configured for this tenant in production.');
    }
  }

  if (!authToken && process.env.BULKSMS_TOKEN_ID && process.env.BULKSMS_TOKEN_SECRET) {
    const rawCreds = `${process.env.BULKSMS_TOKEN_ID}:${process.env.BULKSMS_TOKEN_SECRET}`;
    const base64Creds = Buffer.from(rawCreds).toString('base64');
    authToken = `Basic ${base64Creds}`;
    authMethod = 'Token ID + Token Secret (Dynamic)';
  }

  const apiUrl = `${baseUrl}/messages`;

  if (!authToken) {
    const errorMsg = 'BulkSMS authorization token is missing or misconfigured.';
    console.error(`[BulkSMS] ${errorMsg}`);
    
    await SmsLog.create({
      phoneNumber: formattedPhone,
      message: messageText,
      provider: 'BulkSMS',
      status: 'FAILED',
      errorMessage: 'AUTH_FAILED'
    }).catch(dbErr => console.error('[BulkSMS] Failed to write failure log to DB:', dbErr.message));

    throw new Error('AUTH_FAILED');
  }

  // 4. Sender ID / Payload Logic (South Africa Exception)
  const isSouthAfrican = formattedPhone.startsWith('27');
  const payload = {
    to: formattedPhone,
    body: messageText
  };

  const senderId = process.env.BULKSMS_SENDER_ID;
  if (!isSouthAfrican && senderId) {
    payload.from = senderId;
  }

  const headers = {
    'Authorization': authToken,
    'Content-Type': 'application/json'
  };

  // Safe request log (obscure secret headers)
  const safeHeaders = { ...headers };
  if (safeHeaders['Authorization']) {
    safeHeaders['Authorization'] = safeHeaders['Authorization'].substring(0, 10) + '...REDACTED...';
  }

  console.log('=== BULKSMS REQUEST ===');
  console.log({
    url: apiUrl,
    headers: safeHeaders,
    payload,
    authMethod
  });

  // 5. Retry Mechanism
  const maxRetries = 3;
  const retryDelays = [1000, 3000, 5000]; // 1s, 3s, 5s

  let attempt = 0;
  let success = false;
  let lastError = null;
  let response = null;

  while (attempt < maxRetries && !success) {
    try {
      attempt++;
      if (attempt > 1) {
        console.log(`[BulkSMS] Retrying attempt ${attempt}/${maxRetries} to send to ${formattedPhone}...`);
      }

      response = await axios.post(apiUrl, payload, { headers, timeout: 10000 });
      success = true;
    } catch (error) {
      lastError = error;
      const errorCode = classifyError(error);

      console.error(`[BulkSMS] Attempt ${attempt} failed with error code: ${errorCode}. Message: ${error.message}`);
      if (error.response) {
        console.error('[BulkSMS] HTTP Error Status:', error.response.status);
        console.error('[BulkSMS] HTTP Error Data:', error.response.data);
      }

      // Check if we should retry
      const isTransient = !error.response || [429, 500, 502, 503].includes(error.response.status);
      if (!isTransient || attempt >= maxRetries) {
        break; // Non-transient error, or final attempt reached
      }

      // Wait for backoff delay
      const delay = retryDelays[attempt - 1] || 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // 6. Final Result Handling & Logging to Database
  if (success && response) {
    console.log('=== BULKSMS RESPONSE ===');
    console.log('Status:', response.status);
    console.log('Data:', response.data);

    // Extract Batch ID and Message ID from BulkSMS response
    let batchId = null;
    let messageId = null;

    if (Array.isArray(response.data) && response.data.length > 0) {
      messageId = response.data[0].id;
    } else if (response.data && response.data.id) {
      messageId = response.data.id;
    }

    // Save success log to DB
    const log = await SmsLog.create({
      phoneNumber: formattedPhone,
      message: messageText,
      provider: 'BulkSMS',
      status: 'SENT',
      requestPayload: payload,
      responsePayload: response.data,
      messageId,
      batchId
    }).catch(dbErr => console.error('[BulkSMS] Failed to write success log to DB:', dbErr.message));

    return {
      success: true,
      data: response.data,
      logId: log ? log._id : null
    };
  } else {
    // Audit Error
    const errorCode = classifyError(lastError);
    const errorDetails = lastError.response ? JSON.stringify(lastError.response.data) : lastError.message;

    console.log('=== BULKSMS ERROR ===');
    if (lastError.response) {
      console.log('Status:', lastError.response.status);
      console.log('Headers:', lastError.response.headers);
      console.log('Data:', lastError.response.data);
    } else {
      console.log(lastError.message);
    }

    // Save failure log to DB
    const log = await SmsLog.create({
      phoneNumber: formattedPhone,
      message: messageText,
      provider: 'BulkSMS',
      status: 'FAILED',
      requestPayload: payload,
      responsePayload: lastError.response ? lastError.response.data : null,
      errorMessage: errorCode
    }).catch(dbErr => console.error('[BulkSMS] Failed to write error log to DB:', dbErr.message));

    throw new Error(`SMS dispatch failed: ${errorCode} - ${errorDetails}`);
  }
};

module.exports = {
  sendOtpSms,
  normalizePhoneNumber
};
