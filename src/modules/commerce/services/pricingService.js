const mongoose = require('mongoose');
const ApiPricing = require('../../../models/ApiPricing');

/** Resolve configured pricing for a service. Returns null if not configured or disconnected. */
async function getPricing(service) {
  if (mongoose.connection.readyState !== 1) return null;
  return ApiPricing.findOne({ service }).lean();
}

/** Token cost for `units` of a service (0 if the service is free/unpriced). */
async function tokenCostFor(service, units = 1) {
  const p = await getPricing(service);
  if (!p || !p.enabled) return { tokenCost: 0, pricing: p || null };
  return { tokenCost: (p.tokenCost || 0) * units, pricing: p };
}

module.exports = { getPricing, tokenCostFor };
