/**
 * Migration 008 — Seed marketplace categories + products (token/SMS/OCR/AML/
 * credit/storage packs + premium feature add-ons). Idempotent by code/sku.
 */
const MarketplaceCategory = require('../models/MarketplaceCategory');
const MarketplaceProduct = require('../models/MarketplaceProduct');

const CATEGORIES = [
  { code: 'TOKENS', name: 'API Token Packs', sortOrder: 1 },
  { code: 'MESSAGING', name: 'Messaging Packs', sortOrder: 2 },
  { code: 'VERIFICATION', name: 'Verification Packs', sortOrder: 3 },
  { code: 'STORAGE', name: 'Storage Packs', sortOrder: 4 },
  { code: 'FEATURES', name: 'Premium Features', sortOrder: 5 },
];

const PRODUCTS = [
  { sku: 'TOK-1K', name: '1,000 Tokens', type: 'token_pack', cat: 'TOKENS', price: 99, grants: { tokens: 1000 }, sortOrder: 1 },
  { sku: 'TOK-5K', name: '5,000 Tokens', type: 'token_pack', cat: 'TOKENS', price: 449, grants: { tokens: 5000 }, bonusTokens: 250, sortOrder: 2, isPopular: true },
  { sku: 'TOK-25K', name: '25,000 Tokens', type: 'token_pack', cat: 'TOKENS', price: 1999, grants: { tokens: 25000 }, bonusTokens: 2500, sortOrder: 3 },
  { sku: 'SMS-1K', name: '1,000 SMS Pack', type: 'sms_pack', cat: 'MESSAGING', price: 199, grants: { tokens: 1000, service: 'sms' }, sortOrder: 4 },
  { sku: 'OCR-500', name: '500 OCR Pack', type: 'ocr_pack', cat: 'VERIFICATION', price: 249, grants: { tokens: 1000, service: 'ocr' }, sortOrder: 5 },
  { sku: 'AML-500', name: '500 AML Pack', type: 'aml_pack', cat: 'VERIFICATION', price: 399, grants: { tokens: 1500, service: 'aml' }, sortOrder: 6 },
  { sku: 'CREDIT-250', name: '250 Credit Reports', type: 'credit_pack', cat: 'VERIFICATION', price: 599, grants: { tokens: 1250, service: 'credit_bureau' }, sortOrder: 7 },
  { sku: 'STORAGE-50', name: '50 GB Storage', type: 'storage_pack', cat: 'STORAGE', price: 149, grants: { storageGB: 50 }, sortOrder: 8 },
  { sku: 'FEAT-WALLET', name: 'Wallet Module', type: 'feature', cat: 'FEATURES', price: 0, grants: { feature: 'WALLET' }, sortOrder: 9 },
];

async function up() {
  const catMap = {};
  for (const c of CATEGORIES) {
    let doc = await MarketplaceCategory.findOne({ code: c.code });
    if (!doc) doc = await MarketplaceCategory.create(c);
    catMap[c.code] = doc._id;
  }
  const summary = [];
  for (const p of PRODUCTS) {
    const existing = await MarketplaceProduct.findOne({ sku: p.sku });
    if (existing) { summary.push({ sku: p.sku, action: 'exists' }); continue; }
    await MarketplaceProduct.create({
      sku: p.sku, name: p.name, type: p.type, categoryId: catMap[p.cat], price: p.price,
      grants: p.grants, bonusTokens: p.bonusTokens || 0, currency: 'ZAR', status: 'active',
      sortOrder: p.sortOrder, isPopular: !!p.isPopular,
    });
    summary.push({ sku: p.sku, action: 'created' });
  }
  console.table(summary);
  return summary;
}

async function down() {
  await MarketplaceProduct.deleteMany({ sku: { $in: PRODUCTS.map((p) => p.sku) } });
  await MarketplaceCategory.deleteMany({ code: { $in: CATEGORIES.map((c) => c.code) } });
}

module.exports = { up, down };
