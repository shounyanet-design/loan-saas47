const walletService = require('./walletService');
const pricingService = require('./pricingService');
const usageService = require('../../saas/services/usageService');
const { hasFeature } = require('../../saas/services/featureService');
const notificationService = require('./notificationService');

/**
 * Token Deduction Engine (Part 4).
 *
 * The automatic chain for a metered API call:
 *   validate feature → resolve token cost → atomically deduct from wallet
 *   → record usage (with monetary cost = selling price) → low-balance check.
 *
 * The wallet deduction itself is transactional + idempotent (walletService),
 * so this whole operation is replay-safe and race-safe.
 *
 * Maps a service key to its feature flag for the optional feature gate.
 */
const SERVICE_FEATURE = {
  ocr: 'OCR', aml: 'AML', credit_bureau: 'CREDIT_BUREAU', facetec: 'FACE_VERIFICATION',
  sms: 'SMS', email: 'EMAIL', phone_verification: 'PHONE_VERIFICATION', api: 'API',
};

/**
 * Charge a tenant for using a service.
 * @returns {Promise<{charged:boolean, free?:boolean, tokenCost:number, balanceAfter?:number, idempotent?:boolean}>}
 * @throws  402 INSUFFICIENT_BALANCE | 403 FEATURE_NOT_ENABLED
 */
async function charge(tenantId, service, opts = {}) {
  const units = opts.units || 1;

  // 1. Feature gate (optional, on by default when a mapping exists).
  if (opts.checkFeature !== false && SERVICE_FEATURE[service]) {
    const ok = await hasFeature(SERVICE_FEATURE[service], { tenantId });
    if (!ok) throw Object.assign(new Error(`Feature ${SERVICE_FEATURE[service]} not enabled`), { status: 403, code: 'FEATURE_NOT_ENABLED' });
  }

  // 2. Resolve token cost.
  const { tokenCost, pricing } = await pricingService.tokenCostFor(service, units);

  // 3. Deduct (transactional, idempotent, non-negative-guarded). Free if cost 0.
  let deduction = { idempotent: false };
  if (tokenCost > 0) {
    deduction = await walletService.consume(tenantId, tokenCost, {
      service,
      reason: `Consumed ${tokenCost} token(s) for ${service}`,
      refType: 'UsageRecord',
      refId: opts.refId,
      actor: opts.actor || 'system',
      idempotencyKey: opts.idempotencyKey,
    });
  }

  // 4. Record usage (monetary cost = selling price * units — billing data).
  const cost = pricing ? (pricing.sellingPrice || 0) * units : 0;
  await usageService.record({
    tenantId, service, action: opts.action || 'consume',
    provider: opts.provider || (pricing ? pricing.label : ''),
    units, cost, currency: pricing ? pricing.currency : 'ZAR',
    status: 'success', metadata: opts.metadata,
  });

  // 5. Low-balance notification (best-effort).
  if (tokenCost > 0 && !deduction.idempotent) {
    notificationService.checkLowBalance(tenantId).catch(() => {});
  }

  const balanceAfter = deduction.transaction ? deduction.transaction.balanceAfter : undefined;
  return { charged: tokenCost > 0, free: tokenCost === 0, tokenCost, balanceAfter, idempotent: !!deduction.idempotent };
}

module.exports = { charge, SERVICE_FEATURE };
