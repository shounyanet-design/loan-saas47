const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const MarketplaceProduct = require('../../../models/MarketplaceProduct');
const MarketplaceOrder = require('../../../models/MarketplaceOrder');
const MarketplacePurchase = require('../../../models/MarketplacePurchase');
const Invoice = require('../../../models/Invoice');
const CommercePayment = require('../../../models/CommercePayment');
const walletService = require('../services/walletService');
const marketplaceService = require('../services/marketplaceService');

// All handlers run in the tenant request context (set by `protect`).

// -------- Wallet --------
exports.getWallet = asyncHandler(async (req, res) => sendSuccess(res, 'Wallet', await walletService.getBalance(req.tenantId)));
exports.walletTransactions = asyncHandler(async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
  const skip = parseInt(req.query.skip, 10) || 0;
  return sendSuccess(res, 'Wallet transactions', await walletService.listTransactions(req.tenantId, { limit, skip }));
});

// -------- Marketplace --------
exports.listProducts = asyncHandler(async (req, res) => {
  const products = await MarketplaceProduct.find({ status: 'active' }).sort({ sortOrder: 1 }).lean();
  return sendSuccess(res, 'Products', products);
});

exports.checkout = asyncHandler(async (req, res) => {
  const { items, couponCode, provider, idempotencyKey } = req.body;
  try {
    const result = await marketplaceService.checkout(req.tenantId, {
      items, couponCode, provider: provider || 'manual', actor: req.user?.email, idempotencyKey,
    });
    return sendSuccess(res, 'Checkout created', result, 201);
  } catch (e) {
    return sendError(res, e.message, e.status || 500);
  }
});

// Convenience: buy a token pack by SKU + quantity.
exports.buyTokens = asyncHandler(async (req, res) => {
  const { sku, quantity, couponCode, provider, idempotencyKey } = req.body;
  const product = await MarketplaceProduct.findOne({ sku: String(sku || '').toUpperCase(), status: 'active' });
  if (!product) return sendError(res, 'Product not found', 404);
  try {
    // Token top-ups settle immediately (no live payment gateway wired). Set
    // MARKETPLACE_MANUAL_SETTLEMENT=true to require Super-Admin payment confirmation instead.
    const autoSettle = process.env.MARKETPLACE_MANUAL_SETTLEMENT !== 'true';
    const result = await marketplaceService.checkout(req.tenantId, {
      items: [{ productId: product._id, quantity: quantity || 1 }], couponCode, provider: provider || 'manual', actor: req.user?.email, idempotencyKey, autoSettle,
    });
    return sendSuccess(res, 'Order created', result, 201);
  } catch (e) { return sendError(res, e.message, e.status || 500); }
});

// -------- Orders / Invoices / Purchases (own) --------
exports.myOrders = asyncHandler(async (req, res) => sendSuccess(res, 'Orders', await MarketplaceOrder.find({}).sort({ createdAt: -1 }).limit(100).lean()));
exports.myInvoices = asyncHandler(async (req, res) => sendSuccess(res, 'Invoices', await Invoice.find({}).sort({ createdAt: -1 }).limit(100).lean()));
exports.myPayments = asyncHandler(async (req, res) => sendSuccess(res, 'Payments', await CommercePayment.find({}).sort({ createdAt: -1 }).limit(100).lean()));
exports.myPurchases = asyncHandler(async (req, res) => sendSuccess(res, 'Purchases', await MarketplacePurchase.find({}).sort({ createdAt: -1 }).limit(100).lean()));
