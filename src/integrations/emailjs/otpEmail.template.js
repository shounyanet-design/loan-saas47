/**
 * EmailJS OTP Email Template Meta-Definition
 *
 * Template Variables sent to EmailJS (template_3xrsa8d):
 * - to_email         → Primary recipient field; must be set as "To Email" in EmailJS template
 * - email            → Alias for {{email}} if template uses that variable
 * - user_email       → Alias for {{user_email}} if template uses that variable
 * - recipient_email  → Alias for {{recipient_email}} if template uses that variable
 * - user_name        → Borrower's full name ({{user_name}} in HTML template)
 * - otp_code         → 6-digit OTP code ({{otp_code}} in HTML template)
 * - agreement_number → Loan application ID ({{agreement_number}} in HTML template)
 *
 * ⚠️  IMPORTANT — EmailJS Dashboard Setup:
 *   In your EmailJS template settings, the "To Email" field MUST be set to: {{to_email}}
 *   If it is set to any static/hardcoded address, OTPs will go to the wrong recipient.
 */
const buildOtpEmailPayload = (toEmail, userName, otpCode, agreementNumber) => {
  return {
    user_name: userName,
    otp_code: otpCode,
    to_email: toEmail,
    email: toEmail, // Alias in case the template uses {{email}}
    user_email: toEmail, // Alias in case the template uses {{user_email}}
    recipient_email: toEmail, // Alias in case the template uses {{recipient_email}}
    agreement_number: agreementNumber,
  };
};

module.exports = {
  buildOtpEmailPayload,
};
