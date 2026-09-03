const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const payfastService = require('../services/payfastService');

/**
 * Public Webhook Endpoint for Payfast Instant Transaction Notifications (ITN)
 * POST /api/v1/commerce/payfast/notify
 *
 * Receives server-side POST callbacks from Payfast. Validates signature, verifies
 * notification with Payfast host pingback, enforces tenant-safe execution, and
 * updates Marketplace order / SaaS Subscription status idempotently.
 */
exports.handlePayfastNotify = asyncHandler(async (req, res) => {
  const payload = req.body || {};

  try {
    const result = await payfastService.processItnNotification(payload);
    // Payfast ITN server expects standard 200 HTTP response
    return res.status(200).send('OK');
  } catch (err) {
    console.error('[Payfast Webhook Rejection]', err.message);
    // Standard error logging, return HTTP 400 or 500
    return res.status(err.status || 400).send(err.message || 'ITN processing failed');
  }
});

/**
 * Get Payfast Transaction Status (for tenant dashboard verification)
 * GET /api/v1/commerce/payfast/status/:mPaymentId
 */
exports.getPaymentStatus = asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const mongoose = require('mongoose');
  const PayfastTransaction = require('../../../models/PayfastTransaction');
  const CommercePayment = require('../../../models/CommercePayment');
  const MarketplaceOrder = require('../../../models/MarketplaceOrder');
  const { mPaymentId } = req.params;

  const safeSearch = mPaymentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cleanId = mPaymentId.replace(/^ORD-/, '').replace(/^SUB-/, '');

  const searchQueries = [
    { mPaymentId: { $regex: `^${safeSearch}` } },
    { mPaymentId: { $regex: safeSearch } },
    { mPaymentId: { $regex: cleanId } },
  ];

  if (mongoose.Types.ObjectId.isValid(cleanId)) {
    searchQueries.push({ orderId: cleanId });
  }

  let tx = await PayfastTransaction.findOne({ 
    tenantId: req.tenantId,
    $or: searchQueries
  })
  .sort({ createdAt: -1 })
  .lean();

  if (!tx && mongoose.Types.ObjectId.isValid(cleanId)) {
    // Check CommercePayment fallback
    const payment = await CommercePayment.findOne({
      tenantId: req.tenantId,
      $or: [{ orderId: cleanId }, { providerRef: { $regex: safeSearch } }]
    }).sort({ createdAt: -1 }).lean();

    if (payment) {
      const order = await MarketplaceOrder.findById(payment.orderId).lean();
      return sendSuccess(res, 'Payment status', {
        mPaymentId: payment.providerRef || mPaymentId,
        pfPaymentId: payment.providerRef,
        status: (payment.status === 'succeeded' || order?.status === 'fulfilled') ? 'COMPLETE' : (payment.status === 'failed' ? 'FAILED' : 'pending'),
        amount: payment.amount,
        paymentType: 'marketplace',
        verifiedAt: payment.updatedAt,
      });
    }
  }

  if (!tx) return sendError(res, 'Payment transaction not found', 404);

  return sendSuccess(res, 'Payment status', {
    mPaymentId: tx.mPaymentId,
    pfPaymentId: tx.pfPaymentId,
    status: tx.status,
    amount: tx.amount,
    paymentType: tx.paymentType,
    verifiedAt: tx.verifiedAt,
    failureReason: tx.failureReason,
  });
});
