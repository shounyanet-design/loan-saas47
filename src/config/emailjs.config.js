// ==========================================
// EmailJS Configuration
// All values MUST be set via environment variables.
// No hardcoded fallbacks — missing values will throw at startup.
// ==========================================

const { EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY } = process.env;

if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY || !EMAILJS_PRIVATE_KEY) {
  throw new Error(
    '[EmailJS Config] Missing required environment variables. ' +
    'Ensure EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, and EMAILJS_PRIVATE_KEY are set in .env'
  );
}

module.exports = {
  serviceId: EMAILJS_SERVICE_ID,
  templateId: EMAILJS_TEMPLATE_ID,
  publicKey: EMAILJS_PUBLIC_KEY,
  privateKey: EMAILJS_PRIVATE_KEY,
  apiUrl: 'https://api.emailjs.com/api/v1.0/email/send',
};
