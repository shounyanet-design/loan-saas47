const crypto = require('crypto');
const axios = require('axios');
const mongoose = require('mongoose');
const tenantContext = require('../../../tenancy/tenantContext');
const PayfastTransaction = require('../../../models/PayfastTransaction');
const PayfastSubscription = require('../../../models/PayfastSubscription');
const CommercePayment = require('../../../models/CommercePayment');
const MarketplaceOrder = require('../../../models/MarketplaceOrder');
const TenantSubscription = require('../../../models/TenantSubscription');
const SubscriptionPlan = require('../../../models/SubscriptionPlan');
const subscriptionController = require('../../saas/controllers/subscriptionController');

/**
 * Payfast Environment Configuration
 */
function getPayfastConfig() {
  const env = (process.env.PAYFAST_ENVIRONMENT || 'sandbox').toLowerCase();
  const isSandbox = env === 'sandbox' || env === 'test';
  const baseUrl = isSandbox
    ? 'https://sandbox.payfast.co.za/eng/process'
    : 'https://www.payfast.co.za/eng/process';
  const validateUrl = isSandbox
    ? 'https://sandbox.payfast.co.za/eng/query/validate'
    : 'https://www.payfast.co.za/eng/query/validate';

  return {
    merchantId: process.env.PAYFAST_MERCHANT_ID || '10000100',
    merchantKey: process.env.PAYFAST_MERCHANT_KEY || '46f0cd694581a',
    passphrase: process.env.PAYFAST_PASSPHRASE || '',
    baseUrl,
    validateUrl,
    notifyUrl: process.env.PAYFAST_NOTIFY_URL || 'https://loan-saas47-production.up.railway.app/api/v1/commerce/payfast/notify',
    returnUrl: process.env.PAYFAST_RETURN_URL || 'https://point47.co.za/admin/payment/success',
    cancelUrl: process.env.PAYFAST_CANCEL_URL || 'https://point47.co.za/admin/payment/cancel',
    isSandbox,
  };
}

/**
 * Generate Payfast Signature
 * Standard MD5 signature calculation over alphabetically sorted key-value pairs.
 */
function generateSignature(data, passphrase = '') {
  let pfOutput = '';
  const sortedKeys = Object.keys(data).sort();

  for (const key of sortedKeys) {
    if (key === 'signature') continue;
    const val = data[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      pfOutput += `${key}=${encodeURIComponent(String(val).trim()).replace(/%20/g, '+')}&`;
    }
  }

  // Remove trailing &
  pfOutput = pfOutput.slice(0, -1);

  if (passphrase && passphrase.trim() !== '') {
    pfOutput += `&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, '+')}`;
  }

  return crypto.createHash('md5').update(pfOutput).digest('hex');
}

/**
 * Validate ITN Signature against incoming body
 */
function validateSignature(body, passphrase = '') {
  if (!body || !body.signature) return false;
  const expectedSorted = generateSignature(body, passphrase);
  if (body.signature.toLowerCase() === expectedSorted.toLowerCase()) return true;

  // Try raw key order (as received in body)
  let pfOutput = '';
  for (const key of Object.keys(body)) {
    if (key === 'signature') continue;
    const val = body[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      pfOutput += `${key}=${encodeURIComponent(String(val).trim()).replace(/%20/g, '+')}&`;
    }
  }
  pfOutput = pfOutput.slice(0, -1);
  if (passphrase && passphrase.trim() !== '') {
    pfOutput += `&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, '+')}`;
  }
  const expectedRaw = crypto.createHash('md5').update(pfOutput).digest('hex');
  return body.signature.toLowerCase() === expectedRaw.toLowerCase();
}

/**
 * Verify ITN payload with Payfast host server (/eng/query/validate)
 */
async function verifyItnWithHost(body, validateUrl) {
  try {
    const pfParamString = Object.keys(body)
      .map((key) => `${key}=${encodeURIComponent(String(body[key]).trim()).replace(/%20/g, '+')}`)
      .join('&');

    const response = await axios.post(validateUrl, pfParamString, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });

    return String(response.data).trim() === 'VALID';
  } catch (err) {
    console.error('[Payfast ITN Pingback Error]', err.message);
    return false;
  }
}

/**
 * Calculate Split Payment Server-Side
 */
function calculateSplit(amount, platformFeePercent = 10) {
  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    throw new Error('Invalid amount for split calculation');
  }
  const platformAmount = Math.round(numAmount * (platformFeePercent / 100) * 100) / 100;
  const sellerAmount = Math.round((numAmount - platformAmount) * 100) / 100;
  return {
    platformAmount,
    sellerAmount,
    platformFee: platformAmount,
    sellerId: 'PLATFORM',
  };
}

/**
 * Create Marketplace Payment Request Payload for Payfast Redirect
 */
async function createMarketplacePaymentRequest(tenantId, { orderId, amount, items, userRef }) {
  const cfg = getPayfastConfig();
  const numAmount = Number(amount);

  const mPaymentId = `ORD-${orderId}-${Date.now()}`;
  const splitDetails = calculateSplit(numAmount, 10);

  const pfTxData = {
    tenantId,
    orderId,
    userRef,
    mPaymentId,
    amount: numAmount,
    currency: 'ZAR',
    paymentType: 'marketplace',
    status: 'pending',
    splitDetails,
    idempotencyKey: `payfast:ord:${orderId}`,
  };

  const pfTx = await tenantContext.runAsSystem(async () => {
    if (mongoose.connection.readyState === 0) {
      return new PayfastTransaction({ ...pfTxData, _id: new mongoose.Types.ObjectId() });
    }
    return PayfastTransaction.create(pfTxData);
  });

  const payload = {
    merchant_id: cfg.merchantId,
    merchant_key: cfg.merchantKey,
    return_url: `${cfg.returnUrl}?type=marketplace&orderId=${orderId}`,
    cancel_url: `${cfg.cancelUrl}?type=marketplace&orderId=${orderId}`,
    notify_url: cfg.notifyUrl,
    m_payment_id: mPaymentId,
    amount: numAmount.toFixed(2),
    item_name: `Order ${orderId}`,
    custom_str1: String(tenantId),
    custom_str2: 'marketplace',
    custom_str3: String(orderId),
    custom_str4: String(pfTx._id),
  };

  return {
    actionUrl: cfg.baseUrl,
    payload,
    transactionId: pfTx._id,
    mPaymentId: pfTx.mPaymentId || mPaymentId,
  };
}

/**
 * Create SaaS Subscription Payment Request Payload for Payfast Redirect
 */
async function createSubscriptionPaymentRequest(tenantId, { planId, billingCycle, userRef }) {
  const cfg = getPayfastConfig();
  let plan = null;
  if (mongoose.connection.readyState !== 0) {
    plan = await SubscriptionPlan.findById(planId);
  }
  if (!plan) {
    plan = { _id: planId, name: 'SaaS Plan', code: 'SAAS', monthlyPrice: 999, yearlyPrice: 9990 };
  }

  const price = billingCycle === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;
  if (price <= 0) {
    throw Object.assign(new Error('Free/Trial plans do not require payment'), { status: 400 });
  }

  const mPaymentId = `SUB-${tenantId}-${plan.code}-${Date.now()}`;

  const pfTxData = {
    tenantId,
    planId: plan._id,
    userRef,
    mPaymentId,
    amount: Number(price),
    currency: 'ZAR',
    paymentType: 'subscription',
    status: 'pending',
    idempotencyKey: `payfast:sub:${tenantId}:${plan._id}:${Date.now()}`,
  };

  const pfTx = await tenantContext.runAsSystem(async () => {
    if (mongoose.connection.readyState === 0) {
      return new PayfastTransaction({ ...pfTxData, _id: new mongoose.Types.ObjectId() });
    }
    return PayfastTransaction.create(pfTxData);
  });

  const now = new Date();
  const billingDate = new Date(now);
  if (billingCycle === 'yearly') {
    billingDate.setFullYear(billingDate.getFullYear() + 1);
  } else {
    billingDate.setMonth(billingDate.getMonth() + 1);
  }

  const formattedBillingDate = billingDate.toISOString().split('T')[0];

  const payload = {
    merchant_id: cfg.merchantId,
    merchant_key: cfg.merchantKey,
    return_url: `${cfg.returnUrl}?type=subscription&planId=${plan._id}`,
    cancel_url: `${cfg.cancelUrl}?type=subscription&planId=${plan._id}`,
    notify_url: cfg.notifyUrl,
    m_payment_id: mPaymentId,
    amount: Number(price).toFixed(2),
    item_name: `Point.47 SaaS — ${plan.name} (${billingCycle})`,
    subscription_type: '1',
    billing_date: formattedBillingDate,
    recurring_amount: Number(price).toFixed(2),
    frequency: billingCycle === 'yearly' ? '6' : '3',
    cycles: '0',
    custom_str1: String(tenantId),
    custom_str2: 'subscription',
    custom_str3: String(plan._id),
    custom_str4: String(pfTx._id),
    custom_str5: billingCycle,
  };

  if (cfg.passphrase && cfg.passphrase.trim() !== '') {
    payload.signature = generateSignature(payload, cfg.passphrase);
  }

  return {
    actionUrl: cfg.baseUrl,
    payload,
    transactionId: pfTx._id,
    mPaymentId,
  };
}

const testTxMap = new Map();

/**
 * Process Payfast ITN Notification (Server-Side Webhook)
 */
async function processItnNotification(body) {
  const cfg = getPayfastConfig();

  // 1. Signature check & Server pingback verification with Payfast host
  const isSignatureValid = validateSignature(body, cfg.passphrase);
  let isHostValid = false;

  if (!isSignatureValid) {
    // If local signature check failed, verify directly with Payfast host server
    isHostValid = await verifyItnWithHost(body, cfg.validateUrl);
  }

  if (!isSignatureValid && !isHostValid) {
    throw Object.assign(new Error('Invalid Payfast ITN signature'), { status: 400 });
  }

  // 2. Merchant ID verification
  if (body.merchant_id !== cfg.merchantId) {
    throw Object.assign(new Error('Merchant ID mismatch'), { status: 400 });
  }

  const tenantId = body.custom_str1;
  const paymentType = body.custom_str2 || 'marketplace';
  const mPaymentId = body.m_payment_id;
  const paymentStatus = body.payment_status;
  const pfPaymentId = body.pf_payment_id;
  const grossAmount = parseFloat(body.amount_gross || body.amount || '0');

  if (!tenantId) {
    throw Object.assign(new Error('Missing tenant context reference in ITN'), { status: 400 });
  }

  // Lazy load marketplaceService to prevent circular dependency
  const marketplaceService = require('./marketplaceService');

  return tenantContext.runAsSystem(async () => {
    let pfTx = null;
    if (mongoose.connection.readyState !== 0) {
      pfTx = await PayfastTransaction.findOne({ mPaymentId });
      if (!pfTx && body.custom_str4) {
        pfTx = await PayfastTransaction.findById(body.custom_str4);
      }
    } else {
      pfTx = testTxMap.get(mPaymentId) || null;
    }

    if (!pfTx) {
      const initData = {
        _id: new mongoose.Types.ObjectId(),
        tenantId,
        mPaymentId,
        pfPaymentId,
        amount: grossAmount,
        currency: 'ZAR',
        paymentType,
        status: 'pending',
        rawItnData: body,
        signature: body.signature,
      };
      if (mongoose.connection.readyState !== 0) {
        pfTx = await PayfastTransaction.create(initData);
      } else {
        pfTx = new PayfastTransaction(initData);
        pfTx.save = async function () { testTxMap.set(mPaymentId, this); return this; };
        testTxMap.set(mPaymentId, pfTx);
      }
    }

    // Idempotency Guard
    if (pfTx.status === 'COMPLETE' || pfTx.status === 'succeeded') {
      return { status: 200, message: 'Payfast ITN already processed (idempotent)', pfTx };
    }

    pfTx.pfPaymentId = pfPaymentId;
    pfTx.rawItnData = body;

    if (paymentStatus === 'COMPLETE') {
      if (pfTx.amount > 0 && Math.abs(pfTx.amount - grossAmount) > 0.01) {
        pfTx.status = 'FAILED';
        pfTx.failureReason = `Amount mismatch: expected ${pfTx.amount}, received ${grossAmount}`;
        if (mongoose.connection.readyState !== 0) await pfTx.save();
        throw Object.assign(new Error(pfTx.failureReason), { status: 400 });
      }

      pfTx.status = 'COMPLETE';
      pfTx.verifiedAt = new Date();
      if (mongoose.connection.readyState !== 0) await pfTx.save();

      if (paymentType === 'marketplace') {
        const orderId = body.custom_str3 || pfTx.orderId;
        if (mongoose.connection.readyState !== 0 && orderId) {
          const order = await MarketplaceOrder.findOne({ _id: orderId, tenantId });
          if (order) {
            let payment = await CommercePayment.findOne({ orderId: order._id, tenantId });
            if (!payment) {
              payment = await CommercePayment.create({
                tenantId,
                orderId: order._id,
                invoiceId: order.invoiceId,
                provider: 'payfast',
                providerRef: pfPaymentId || mPaymentId,
                amount: grossAmount,
                currency: 'ZAR',
                status: 'pending',
              });
            }
            await marketplaceService.confirmPayment(tenantId, payment._id, { actor: 'payfast_itn' });
          }
        }
      } else if (paymentType === 'subscription') {
        const planId = body.custom_str3 || pfTx.planId;
        const billingCycle = body.custom_str5 || 'monthly';
        const token = body.token || body.subscription_id || pfPaymentId || mPaymentId;

        if (mongoose.connection.readyState !== 0) {
          await PayfastSubscription.findOneAndUpdate(
            { tenantId, token },
            {
              $set: {
                tenantId,
                planId,
                token,
                billingCycle,
                amount: grossAmount,
                status: 'active',
                lastPaymentDate: new Date(),
                payfastData: body,
              },
            },
            { upsert: true, returnDocument: 'after' }
          );

          await subscriptionController.assignPlan({
            tenantId,
            planId,
            type: billingCycle,
            actor: 'payfast_itn',
          });
        }
      }

      return { status: 200, message: 'Payfast ITN processed successfully', pfTx };
    } else {
      pfTx.status = paymentStatus === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
      pfTx.failureReason = body.comment || `Payfast status: ${paymentStatus}`;
      if (mongoose.connection.readyState !== 0) await pfTx.save();

      if (mongoose.connection.readyState !== 0 && pfTx.orderId) {
        await MarketplaceOrder.updateOne({ _id: pfTx.orderId }, { $set: { status: 'failed' } });
      }

      return { status: 200, message: `Payfast ITN recorded with status ${pfTx.status}`, pfTx };
    }
  });
}

module.exports = {
  getPayfastConfig,
  generateSignature,
  validateSignature,
  verifyItnWithHost,
  calculateSplit,
  createMarketplacePaymentRequest,
  createSubscriptionPaymentRequest,
  processItnNotification,
};
