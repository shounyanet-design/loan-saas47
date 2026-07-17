const mongoose = require('mongoose');
const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const tenantContext = require('../../../tenancy/tenantContext');
const { buildQuery, paginate } = require('../../platform/utils/queryFeatures');
const { audit } = require('../../saas/utils/auditAny');

const ApiPricing = require('../../../models/ApiPricing');
const MarketplaceCategory = require('../../../models/MarketplaceCategory');
const MarketplaceProduct = require('../../../models/MarketplaceProduct');
const MarketplaceCoupon = require('../../../models/MarketplaceCoupon');
const MarketplaceOrder = require('../../../models/MarketplaceOrder');
const MarketplacePurchase = require('../../../models/MarketplacePurchase');
const Invoice = require('../../../models/Invoice');
const CommercePayment = require('../../../models/CommercePayment');
const Wallet = require('../../../models/Wallet');
const WalletAdjustment = require('../../../models/WalletAdjustment');
const TenantSubscription = require('../../../models/TenantSubscription');
const SubscriptionPlan = require('../../../models/SubscriptionPlan');

const walletService = require('../services/walletService');
const marketplaceService = require('../services/marketplaceService');
const billingService = require('../services/billingService');

// -------- API / Token pricing --------
exports.listPricing = asyncHandler(async (req, res) => sendSuccess(res, 'API pricing', await ApiPricing.find({}).lean()));
exports.upsertPricing = asyncHandler(async (req, res) => {
  const { service } = req.params;
  const fields = (({ label, tokenCost, providerCost, sellingPrice, currency, enabled }) => ({ label, tokenCost, providerCost, sellingPrice, currency, enabled }))(req.body);
  Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);
  const doc = await ApiPricing.findOneAndUpdate({ service }, { $set: fields, $setOnInsert: { service } }, { returnDocument: 'after', upsert: true });
  await audit(req, { action: 'API_PRICING_UPDATED', entity: 'ApiPricing', entityId: service, newValues: fields });
  return sendSuccess(res, 'Pricing saved', doc);
});

// -------- Categories --------
exports.listCategories = asyncHandler(async (req, res) => sendSuccess(res, 'Categories', await MarketplaceCategory.find({}).sort({ sortOrder: 1 }).lean()));
exports.createCategory = asyncHandler(async (req, res) => {
  if (!req.body.name || !req.body.code) return sendError(res, 'name and code required', 400);
  const code = String(req.body.code).toUpperCase();
  if (await MarketplaceCategory.findOne({ code })) return sendError(res, 'code exists', 409);
  const doc = await MarketplaceCategory.create({ ...req.body, code });
  await audit(req, { action: 'MARKETPLACE_CATEGORY_CREATED', entity: 'MarketplaceCategory', entityId: doc._id });
  return sendSuccess(res, 'Category created', doc, 201);
});

// -------- Products --------
exports.listProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip, sort, filter } = buildQuery(req.query, { searchFields: ['name', 'sku'], filterFields: ['type', 'status', 'categoryId'], sortFields: ['sortOrder', 'price', 'name', 'createdAt'], defaultSort: 'sortOrder' });
  const [items, total] = await Promise.all([MarketplaceProduct.find(filter).sort(sort).skip(skip).limit(limit).lean(), MarketplaceProduct.countDocuments(filter)]);
  return sendSuccess(res, 'Products', paginate(items, total, page, limit));
});
exports.createProduct = asyncHandler(async (req, res) => {
  const { sku, name, type, price } = req.body;
  if (!sku || !name || !type || price == null) return sendError(res, 'sku, name, type, price required', 400);
  if (await MarketplaceProduct.findOne({ sku: String(sku).toUpperCase() })) return sendError(res, 'sku exists', 409);
  const doc = await MarketplaceProduct.create({ ...req.body, sku: String(sku).toUpperCase() });
  await audit(req, { action: 'MARKETPLACE_PRODUCT_CREATED', entity: 'MarketplaceProduct', entityId: doc._id, newValues: { sku: doc.sku } });
  return sendSuccess(res, 'Product created', doc, 201);
});
exports.updateProduct = asyncHandler(async (req, res) => {
  const doc = await MarketplaceProduct.findById(req.params.id);
  if (!doc) return sendError(res, 'Product not found', 404);
  ['name', 'description', 'categoryId', 'type', 'grants', 'price', 'priceTiers', 'bonusTokens', 'status', 'sortOrder', 'isPopular', 'currency'].forEach((f) => { if (req.body[f] !== undefined) doc[f] = req.body[f]; });
  await doc.save();
  await audit(req, { action: 'MARKETPLACE_PRODUCT_UPDATED', entity: 'MarketplaceProduct', entityId: doc._id });
  return sendSuccess(res, 'Product updated', doc);
});
exports.deleteProduct = asyncHandler(async (req, res) => {
  const doc = await MarketplaceProduct.findById(req.params.id);
  if (!doc) return sendError(res, 'Product not found', 404);
  doc.status = 'archived'; await doc.save();
  await audit(req, { action: 'MARKETPLACE_PRODUCT_ARCHIVED', entity: 'MarketplaceProduct', entityId: doc._id });
  return sendSuccess(res, 'Product archived', doc);
});

// -------- Coupons --------
exports.listCoupons = asyncHandler(async (req, res) => sendSuccess(res, 'Coupons', await MarketplaceCoupon.find({}).sort({ createdAt: -1 }).lean()));
exports.createCoupon = asyncHandler(async (req, res) => {
  const { code, discountType, value } = req.body;
  if (!code || !discountType || value == null) return sendError(res, 'code, discountType, value required', 400);
  if (await MarketplaceCoupon.findOne({ code: String(code).toUpperCase() })) return sendError(res, 'code exists', 409);
  const doc = await MarketplaceCoupon.create({ ...req.body, code: String(code).toUpperCase() });
  await audit(req, { action: 'COUPON_CREATED', entity: 'MarketplaceCoupon', entityId: doc._id });
  return sendSuccess(res, 'Coupon created', doc, 201);
});

// -------- Wallet overview + adjustments --------
exports.walletOverview = asyncHandler(async (req, res) => {
  const wallets = await tenantContext.runAsSystem(() => Wallet.find({}).lean());
  const totals = wallets.reduce((a, w) => ({ available: a.available + w.availableTokens, consumed: a.consumed + w.consumedTokens, purchased: a.purchased + w.purchasedTokens }), { available: 0, consumed: 0, purchased: 0 });
  return sendSuccess(res, 'Wallet overview', { count: wallets.length, totals, wallets });
});
exports.getTenantWallet = asyncHandler(async (req, res) => sendSuccess(res, 'Wallet', await walletService.getBalance(req.params.tenantId)));
exports.adjustWallet = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { direction, tokens, reason } = req.body;
  if (!['credit', 'debit'].includes(direction) || !tokens || !reason) return sendError(res, 'direction, tokens, reason required', 400);
  await walletService.getOrCreate(tenantId);
  const result = direction === 'credit'
    ? await walletService.credit(tenantId, tokens, { type: 'adjustment', reason, actor: req.platformUser.email, refType: 'Adjustment' })
    : await walletService.debit(tenantId, tokens, { type: 'adjustment', reason, actor: req.platformUser.email, refType: 'Adjustment' });
  await tenantContext.runAsSystem(() => WalletAdjustment.create({ tenantId, direction, tokens, reason, actor: req.platformUser.email, walletTransactionId: result.transaction._id }));
  await audit(req, { action: 'WALLET_ADJUSTED', entity: 'Wallet', entityId: tenantId, newValues: { direction, tokens, reason } });
  return sendSuccess(res, 'Wallet adjusted', await walletService.getBalance(tenantId));
});

// -------- Orders / Invoices / Payments --------
exports.listOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip, sort, filter } = buildQuery(req.query, { filterFields: ['status'], sortFields: ['createdAt', 'total'], defaultSort: 'createdAt' });
  const [items, total] = await tenantContext.runAsSystem(() => Promise.all([MarketplaceOrder.find(filter).sort(sort).skip(skip).limit(limit).lean(), MarketplaceOrder.countDocuments(filter)]));
  return sendSuccess(res, 'Orders', paginate(items, total, page, limit));
});
exports.listInvoices = asyncHandler(async (req, res) => {
  const { page, limit, skip, sort, filter } = buildQuery(req.query, { filterFields: ['status', 'type'], sortFields: ['createdAt', 'total'], defaultSort: 'createdAt' });
  const [items, total] = await tenantContext.runAsSystem(() => Promise.all([Invoice.find(filter).sort(sort).skip(skip).limit(limit).lean(), Invoice.countDocuments(filter)]));
  return sendSuccess(res, 'Invoices', paginate(items, total, page, limit));
});
exports.listPayments = asyncHandler(async (req, res) => {
  const { page, limit, skip, sort, filter } = buildQuery(req.query, { filterFields: ['status', 'provider'], sortFields: ['createdAt', 'amount'], defaultSort: 'createdAt' });
  const [items, total] = await tenantContext.runAsSystem(() => Promise.all([CommercePayment.find(filter).sort(sort).skip(skip).limit(limit).lean(), CommercePayment.countDocuments(filter)]));
  return sendSuccess(res, 'Payments', paginate(items, total, page, limit));
});
// Confirm/settle a manual (or externally-paid) payment → fulfills the order.
exports.confirmPayment = asyncHandler(async (req, res) => {
  const payment = await tenantContext.runAsSystem(() => CommercePayment.findById(req.params.paymentId));
  if (!payment) return sendError(res, 'Payment not found', 404);
  const result = await marketplaceService.confirmPayment(payment.tenantId, payment._id, { actor: req.platformUser.email });
  await audit(req, { action: 'PAYMENT_CONFIRMED', entity: 'CommercePayment', entityId: payment._id });
  return sendSuccess(res, 'Payment confirmed', result);
});

// -------- Analytics / Revenue --------
exports.analytics = asyncHandler(async (req, res) => {
  const data = await tenantContext.runAsSystem(async () => {
    const paidMatch = { status: 'paid' };
    const [revenueAgg] = await Invoice.aggregate([{ $match: paidMatch }, { $group: { _id: null, total: { $sum: '$total' } } }]);
    const monthlySales = await Invoice.aggregate([
      { $match: paidMatch },
      { $group: { _id: { y: { $year: '$paidAt' }, m: { $month: '$paidAt' } }, total: { $sum: '$total' }, count: { $sum: 1 } } },
      { $sort: { '_id.y': 1, '_id.m': 1 } }, { $project: { _id: 0, year: '$_id.y', month: '$_id.m', total: 1, count: 1 } },
    ]);
    const topCustomers = await Invoice.aggregate([
      { $match: paidMatch }, { $group: { _id: '$tenantId', total: { $sum: '$total' } } }, { $sort: { total: -1 } }, { $limit: 10 },
    ]);
    const UsageRecord = mongoose.model('UsageRecord');
    const topApis = await UsageRecord.aggregate([{ $group: { _id: '$service', units: { $sum: '$units' }, cost: { $sum: '$cost' } } }, { $sort: { units: -1 } }, { $limit: 10 }, { $project: { _id: 0, service: '$_id', units: 1, cost: 1 } }]);
    const marketplaceSales = await MarketplacePurchase.aggregate([{ $group: { _id: '$type', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $project: { _id: 0, type: '$_id', amount: 1, count: 1 } }]);
    const subDist = await TenantSubscription.aggregate([{ $group: { _id: '$planId', count: { $sum: 1 } } }]);
    const plans = await SubscriptionPlan.find({}).lean();
    const planMap = Object.fromEntries(plans.map((p) => [String(p._id), p]));
    // MRR: sum of monthlyPrice across active paid subscriptions (yearly normalized).
    const activeSubs = await TenantSubscription.find({ status: { $in: ['active', 'trialing'] } }).lean();
    let mrr = 0;
    for (const s of activeSubs) {
      const plan = planMap[String(s.planId)];
      if (!plan) continue;
      mrr += s.billingCycle === 'yearly' ? (plan.yearlyPrice || 0) / 12 : (plan.monthlyPrice || 0);
    }
    const walletAgg = await Wallet.aggregate([{ $group: { _id: null, available: { $sum: '$availableTokens' }, consumed: { $sum: '$consumedTokens' }, purchased: { $sum: '$purchasedTokens' } } }]);
    return {
      revenueTotal: revenueAgg ? revenueAgg.total : 0,
      mrr: Number(mrr.toFixed(2)), arr: Number((mrr * 12).toFixed(2)),
      monthlySales, topCustomers, topApis, marketplaceSales,
      subscriptionDistribution: subDist.map((d) => ({ plan: planMap[String(d._id)]?.code || 'unknown', count: d.count })),
      walletUsage: walletAgg[0] || { available: 0, consumed: 0, purchased: 0 },
    };
  });
  return sendSuccess(res, 'Commerce analytics', data);
});
