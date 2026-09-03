const tenantContext = require('../../../tenancy/tenantContext');
const MarketplaceProduct = require('../../../models/MarketplaceProduct');
const MarketplaceOrder = require('../../../models/MarketplaceOrder');
const MarketplaceCoupon = require('../../../models/MarketplaceCoupon');
const MarketplacePurchase = require('../../../models/MarketplacePurchase');
const billingService = require('./billingService');
const walletService = require('./walletService');
const notificationService = require('./notificationService');
const { getProvider } = require('../payments');

/**
 * Checkout (Part 6). Creates: Order → Invoice (pending) → Payment (via provider).
 * Fulfillment (wallet credit + purchase records) happens on payment confirmation
 * so tokens are only granted once money is settled.
 */
async function checkout(tenantId, { items = [], couponCode, provider = 'manual', actor, idempotencyKey, autoSettle = false } = {}) {
  if (!Array.isArray(items) || items.length === 0) throw Object.assign(new Error('No items to checkout'), { status: 400 });

  return tenantContext.runAsSystem(async () => {
    // Idempotency: a prior order with the same key returns that order.
    if (idempotencyKey) {
      const prior = await MarketplaceOrder.findOne({ idempotencyKey });
      if (prior) return { order: prior, idempotent: true };
    }

    // Build order lines from real products.
    const orderItems = [];
    let subtotal = 0;
    for (const it of items) {
      const product = await MarketplaceProduct.findById(it.productId);
      if (!product || product.status !== 'active') throw Object.assign(new Error(`Product unavailable: ${it.productId}`), { status: 400 });
      const qty = Math.max(1, it.quantity || 1);
      const unitPrice = product.unitPriceFor(qty);
      const lineTotal = Number((unitPrice * qty).toFixed(2));
      subtotal += lineTotal;
      orderItems.push({
        productId: product._id, sku: product.sku, name: product.name, type: product.type,
        quantity: qty, unitPrice, lineTotal, grants: product.grants, bonusTokens: product.bonusTokens * qty,
      });
    }
    subtotal = Number(subtotal.toFixed(2));

    // Coupon.
    let discount = 0; let coupon = null;
    if (couponCode) {
      coupon = await MarketplaceCoupon.findOne({ code: String(couponCode).toUpperCase() });
      if (!coupon) throw Object.assign(new Error('Invalid coupon'), { status: 400 });
      const usedByTenant = await MarketplaceOrder.countDocuments({ tenantId, couponCode: coupon.code, status: { $in: ['paid', 'fulfilled'] } });
      const ev = coupon.evaluate(subtotal, orderItems[0]?.type, usedByTenant);
      if (!ev.ok) throw Object.assign(new Error(ev.reason), { status: 400 });
      discount = ev.discount;
    }
    const total = Math.max(0, Number((subtotal - discount).toFixed(2)));

    // Order.
    let order;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        [order] = await MarketplaceOrder.create([{
          tenantId, orderNumber: billingService.genNumber('ORD'), items: orderItems,
          subtotal, discount, tax: 0, total, currency: orderItems[0] ? 'ZAR' : 'ZAR',
          couponCode: coupon ? coupon.code : undefined, status: 'pending', placedBy: actor, idempotencyKey,
        }]);
        break;
      } catch (e) { if (e.code === 11000 && attempt < 4) continue; throw e; }
    }

    // Invoice (pending).
    const invoice = await billingService.createInvoice(tenantId, {
      type: 'marketplace', orderId: order._id, couponCode: coupon ? coupon.code : undefined, discount,
      items: orderItems.map((i) => ({ description: `${i.name} x${i.quantity}`, sku: i.sku, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal })),
    });

    // Payment intent via provider abstraction.
    const prov = getProvider(provider);
    const charge = await prov.createCharge({ amount: total, currency: 'ZAR', invoice, tenantId });
    const payment = await billingService.createPayment(tenantId, {
      invoiceId: invoice._id, orderId: order._id, amount: total, provider, providerRef: charge.providerRef,
      status: charge.status === 'succeeded' ? 'succeeded' : 'pending', idempotencyKey: idempotencyKey ? `${idempotencyKey}:pay` : undefined,
      metadata: charge.payfastPayload ? { redirectUrl: charge.redirectUrl, payfastPayload: charge.payfastPayload } : undefined,
    });

    await MarketplaceOrder.updateOne({ _id: order._id }, { $set: { invoiceId: invoice._id, paymentId: payment._id } });
    await notificationService.notify(tenantId, 'INVOICE_GENERATED', 'Invoice generated', `Invoice ${invoice.invoiceNumber} for ${total} ZAR.`, { tenantId: String(tenantId), invoiceId: String(invoice._id) });

    // Fulfill now when the provider settled immediately (zero-total / auto-capture)
    // OR the caller requested auto-settlement (e.g. internal token top-ups with no
    // live gateway). Otherwise the order stays pending for manual/gateway settlement.
    let fulfillment = null;
    if ((charge.status === 'succeeded' || total === 0 || autoSettle) && provider !== 'payfast') {
      fulfillment = await confirmPayment(tenantId, payment._id, { actor });
    }

    const fresh = await MarketplaceOrder.findById(order._id);
    return {
      order: fresh,
      invoice,
      payment,
      requiresAction: !fulfillment && !!charge.requiresExternalAction && total > 0,
      action: charge.requiresExternalAction ? { redirectUrl: charge.redirectUrl, payfastPayload: charge.payfastPayload } : undefined,
      fulfillment,
    };
  });
}

/**
 * Confirm a payment and fulfill its order: mark paid → grant tokens/features →
 * record purchases → bump coupon → notify. Idempotent (no double-fulfillment).
 */
async function confirmPayment(tenantId, paymentId, { actor } = {}) {
  return tenantContext.runAsSystem(async () => {
    const CommercePayment = require('../../../models/CommercePayment');
    const payment = await CommercePayment.findOne({ _id: paymentId, tenantId });
    if (!payment) throw Object.assign(new Error('Payment not found'), { status: 404 });
    const order = await MarketplaceOrder.findOne({ _id: payment.orderId, tenantId });
    if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });

    // Idempotency guard: already fulfilled.
    if (order.status === 'fulfilled') return { alreadyFulfilled: true, order };

    await billingService.transitionPayment(tenantId, payment._id, 'succeeded', 'confirmed');
    await billingService.markInvoicePaid(tenantId, payment.invoiceId, payment.amount);

    let totalTokens = 0;
    for (const item of order.items) {
      const grants = item.grants || {};
      const tokens = (grants.tokens || 0) * item.quantity + (item.bonusTokens || 0);
      if (tokens > 0) {
        await walletService.credit(tenantId, tokens, {
          reason: `Purchase ${order.orderNumber}: ${item.name}`,
          type: 'purchase', refType: 'Order', refId: order._id, actor: actor || 'system',
          idempotencyKey: `fulfill:${order._id}:${item.sku}`,
          bonus: false,
        });
        totalTokens += tokens;
      }
      await MarketplacePurchase.create([{
        tenantId, orderId: order._id, invoiceId: payment.invoiceId, productId: item.productId,
        sku: item.sku, name: item.name, type: item.type, quantity: item.quantity, amount: item.lineTotal,
        tokensGranted: tokens, grants: item.grants,
      }]).catch((e) => { if (e.code !== 11000) throw e; });
    }

    if (order.couponCode) {
      await MarketplaceCoupon.updateOne({ code: order.couponCode }, { $inc: { redemptions: 1 } });
    }
    await MarketplaceOrder.updateOne({ _id: order._id }, { $set: { status: 'fulfilled', fulfilledAt: new Date() } });

    await notificationService.notify(tenantId, 'PAYMENT_SUCCESS', 'Payment received', `Payment for order ${order.orderNumber} succeeded.`, { tenantId: String(tenantId) });
    if (totalTokens > 0) await notificationService.notify(tenantId, 'TOKENS_ADDED', 'Tokens added', `${totalTokens} tokens added to your wallet.`, { tenantId: String(tenantId) });
    await notificationService.notify(tenantId, 'PURCHASE_SUCCESS', 'Purchase complete', `Order ${order.orderNumber} fulfilled.`, { tenantId: String(tenantId) });

    const fresh = await MarketplaceOrder.findById(order._id);
    return { fulfilled: true, order: fresh, tokensGranted: totalTokens };
  });
}

module.exports = { checkout, confirmPayment };
