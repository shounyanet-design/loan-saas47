/**
 * Hard guard: development sandbox bypass flags are NEVER honoured when
 * NODE_ENV === 'production', regardless of the env var value. This prevents a
 * stray DEV_ONLY_BYPASS_* in a production .env from silently skipping
 * KYC/identity/sequential-verification gating.
 */
const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Centralized sandbox bypass helper.
 * Returns true when DEV_ONLY_BYPASS_SEQUENTIAL_GATING=true (non-production only).
 */
const isDevelopmentSandboxBypassEnabled = () =>
  !isProduction() && process.env.DEV_ONLY_BYPASS_SEQUENTIAL_GATING === 'true';

/**
 * Centralized next step bypass helper.
 * Returns true when DEV_ONLY_BYPASS_NEXT_STEP=true (non-production only).
 */
const isDevelopmentNextStepBypassEnabled = () =>
  !isProduction() && process.env.DEV_ONLY_BYPASS_NEXT_STEP === 'true';

module.exports = { 
  isDevelopmentSandboxBypassEnabled,
  isDevelopmentNextStepBypassEnabled 
};
