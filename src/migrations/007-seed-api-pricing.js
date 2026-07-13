/**
 * Migration 007 — Seed default token economics per shared API (idempotent).
 * Values are starting points; Super Admin can change them at any time.
 */
const ApiPricing = require('../models/ApiPricing');

const PRICING = [
  { service: 'ocr', label: 'OCR', tokenCost: 2, providerCost: 0.30, sellingPrice: 0.60 },
  { service: 'aml', label: 'AML Screening', tokenCost: 3, providerCost: 0.50, sellingPrice: 1.00 },
  { service: 'credit_bureau', label: 'Credit Bureau', tokenCost: 5, providerCost: 1.20, sellingPrice: 2.50 },
  { service: 'facetec', label: 'Face Verification', tokenCost: 4, providerCost: 0.80, sellingPrice: 1.80 },
  { service: 'sms', label: 'SMS', tokenCost: 1, providerCost: 0.10, sellingPrice: 0.25 },
  { service: 'email', label: 'Email', tokenCost: 1, providerCost: 0.01, sellingPrice: 0.05 },
  { service: 'phone_verification', label: 'Phone Verification', tokenCost: 2, providerCost: 0.20, sellingPrice: 0.50 },
  { service: 'api', label: 'Generic API Call', tokenCost: 1, providerCost: 0.001, sellingPrice: 0.01 },
];

async function up() {
  const summary = [];
  for (const p of PRICING) {
    const existing = await ApiPricing.findOne({ service: p.service });
    if (existing) { summary.push({ service: p.service, action: 'exists' }); continue; }
    await ApiPricing.create({ ...p, currency: 'ZAR', enabled: true });
    summary.push({ service: p.service, action: 'created' });
  }
  console.table(summary);
  return summary;
}

async function down() {
  await ApiPricing.deleteMany({ service: { $in: PRICING.map((p) => p.service) } });
}

module.exports = { up, down };
