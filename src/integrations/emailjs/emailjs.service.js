const config = require('./emailjs.config');
const { buildOtpEmailPayload } = require('./otpEmail.template');
const tenantContext = require('../../tenancy/tenantContext');
const credentialService = require('../../modules/saas/services/credentialService');

/**
 * Sends OTP Email using the EmailJS HTTP REST API
 * @param {string} toEmail - Borrower's email address
 * @param {string} userName - Borrower's full name
 * @param {string} otpCode - Generated 6-digit OTP code
 * @returns {Promise<boolean>} Resolves to true if the email is successfully sent
 */
const sendOtpEmail = async (toEmail, userName, otpCode, agreementNumber) => {
  if (!toEmail || typeof toEmail !== 'string' || !toEmail.includes('@')) {
    console.error(`[EmailJS] Email validation failed for recipient: "${toEmail}"`);
    throw new Error('Invalid email address format.');
  }

  const tenantId = tenantContext.getTenantId();
  let serviceId = config.serviceId;
  let templateId = config.templateId;
  let publicKey = config.publicKey;
  let privateKey = config.privateKey;
  let apiUrl = config.apiUrl || 'https://api.emailjs.com/api/v1.0/email/send';

  if (tenantId) {
    const resolved = await credentialService.resolve(tenantId, 'emailjs');
    if (resolved && resolved.source === 'tenant') {
      const creds = resolved.credentials || {};
      serviceId = creds.serviceId || serviceId;
      templateId = creds.templateId || templateId;
      publicKey = creds.publicKey || publicKey;
      privateKey = creds.privateKey || privateKey;
    } else if (process.env.NODE_ENV === 'production' && resolved.source === 'env') {
      throw new Error('EmailJS credentials are not configured for this tenant in production.');
    }
  }

  const templateParams = buildOtpEmailPayload(toEmail, userName, otpCode, agreementNumber);

  const payload = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    accessToken: privateKey,
    template_params: templateParams,
  };

  try {
    console.log(`[EmailJS] Generating OTP signature request...`);
    console.log(`[EmailJS] Dispatching OTP email via REST API to: ${toEmail}`);
    console.log(`[EmailJS] Payload being sent to EmailJS:`, JSON.stringify({
      service_id: payload.service_id,
      template_id: payload.template_id,
      user_id: payload.user_id,
      template_params: payload.template_params,
      // intentionally hiding accessToken from logs
    }, null, 2));
    
    // Bound the request — fetch has no default timeout, so a hung EmailJS
    // endpoint would otherwise stall the OTP flow indefinitely.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`[EmailJS] Email delivery failure. HTTP ${response.status}: ${responseText}`);
      if (response.status === 403) {
        throw new Error('EmailJS API Forbidden (403): Secure Private Key/Access Token or Public Key is incorrect.');
      }
      throw new Error(`EmailJS delivery failed with status ${response.status}: ${responseText}`);
    }

    console.log(`[EmailJS] OTP email successfully sent to ${toEmail}. Status: ${response.status}`);
    return true;
  } catch (error) {
    console.error(`[EmailJS] Critical send error for ${toEmail}:`, error.message);
    throw error;
  }
};

/**
 * Sends Password Reset Email via EmailJS API
 */
const sendPasswordResetEmail = async (toEmail, userName, resetToken) => {
  if (!toEmail || typeof toEmail !== 'string' || !toEmail.includes('@')) {
    console.error(`[EmailJS] Email validation failed for recipient: "${toEmail}"`);
    throw new Error('Invalid email address format.');
  }

  const serviceId = config.serviceId;
  const templateId = config.templateId;
  const publicKey = config.publicKey;
  const privateKey = config.privateKey;
  const apiUrl = config.apiUrl || 'https://api.emailjs.com/api/v1.0/email/send';

  const templateParams = {
    to_email: toEmail,
    to_name: userName || 'Valued User',
    otp_code: resetToken,
    agreement_number: 'PWD-RESET',
    message: `Your password reset code is: ${resetToken}. Please use this code to reset your password.`,
  };

  const payload = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    accessToken: privateKey,
    template_params: templateParams,
  };

  try {
    console.log(`[EmailJS] Dispatching Password Reset Email via REST API to: ${toEmail}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await response.text();
    if (!response.ok) {
      console.error(`[EmailJS] Password reset email delivery status ${response.status}: ${responseText}`);
      return false;
    }

    console.log(`[EmailJS] Password reset email successfully sent to ${toEmail}. Status: ${response.status}`);
    return true;
  } catch (error) {
    console.error(`[EmailJS] Password reset email error for ${toEmail}:`, error.message);
    return false;
  }
};

module.exports = {
  sendOtpEmail,
  sendPasswordResetEmail,
};
