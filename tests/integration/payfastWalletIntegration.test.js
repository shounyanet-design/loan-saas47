const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const payfastService = require('../../src/modules/commerce/services/payfastService');
const marketplaceService = require('../../src/modules/commerce/services/marketplaceService');
const walletService = require('../../src/modules/commerce/services/walletService');
const MarketplaceProduct = require('../../src/models/MarketplaceProduct');
const MarketplaceOrder = require('../../src/models/MarketplaceOrder');
const MarketplacePurchase = require('../../src/models/MarketplacePurchase');
const CommercePayment = require('../../src/models/CommercePayment');
const Invoice = require('../../src/models/Invoice');
const Wallet = require('../../src/models/Wallet');
const WalletTransaction = require('../../src/models/WalletTransaction');
const PayfastTransaction = require('../../src/models/PayfastTransaction');
const Tenant = require('../../src/models/Tenant');
const tenantContext = require('../../src/tenancy/tenantContext');

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  // Ensure indexes are built to prevent idempotency test errors (race conditions)
  await Promise.all(Object.values(mongoose.models).map(m => m.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

test('Payfast Marketplace Purchase -> Wallet History Integration', async (t) => {
  const tenantId = new mongoose.Types.ObjectId().toString();

  await tenantContext.runAsSystem(async () => {
    // 1. Setup Tenant and Product
    await Tenant.create({ 
      _id: tenantId, 
      name: 'Integration Test Tenant',
      companyName: 'Integration Co',
      companyCode: 'INT001',
      country: 'ZAF',
      currency: 'ZAR',
      timezone: 'Africa/Johannesburg'
    });
    
    // Ensure Wallet exists
    await walletService.getOrCreate(tenantId);
    let wallet = await Wallet.findOne({ tenantId });
    assert.equal(wallet.availableTokens, 0, 'Wallet should start with 0 tokens');

    const product = await MarketplaceProduct.create({
      sku: 'TOK-INT-500',
      name: '500 Tokens Package',
      type: 'token_pack',
      grants: { tokens: 500 },
      price: 500,
      unitPrice: 500,
      status: 'active'
    });

    // 2. Perform Checkout (creates pending order)
    const checkoutResult = await marketplaceService.checkout(tenantId, {
      items: [{ productId: product._id, quantity: 1 }],
      provider: 'payfast',
      actor: 'test@lms.com',
      autoSettle: false,
    });

    const order = checkoutResult.order;
    assert.equal(order.status, 'pending', 'Order should start pending');
    assert.equal(order.items[0].grants.tokens, 500);

    // Get Payment and Invoice
    const payment = await CommercePayment.findOne({ orderId: order._id });
    const invoice = await Invoice.findById(order.invoiceId);
    
    assert.equal(payment.status, 'pending', 'CommercePayment should start pending');
    assert.equal(invoice.status, 'pending', 'Invoice should start pending');
    
    // Verify wallet untouched
    wallet = await Wallet.findOne({ tenantId });
    assert.equal(wallet.availableTokens, 0, 'Wallet should not be credited yet');
    
    let txns = await walletService.listTransactions(tenantId);
    assert.equal(txns.length, 0, 'No wallet transactions should exist yet');

    // 3. Generate Payfast Request (sets mPaymentId)
    const pfRequest = await payfastService.createMarketplacePaymentRequest(tenantId, {
      orderId: order._id,
      amount: 500,
      itemName: '500 Tokens Package',
      returnUrl: 'http://localhost/success',
      cancelUrl: 'http://localhost/cancel'
    });
    
    const mPaymentId = pfRequest.mPaymentId;
    assert.ok(mPaymentId.startsWith(`ORD-${order._id}-`), 'mPaymentId should be formatted correctly');

    // 4. Simulate Verified ITN Callback
    const cfg = payfastService.getPayfastConfig();
    const payload = {
      m_payment_id: mPaymentId,
      pf_payment_id: 'PF_TEST_123',
      payment_status: 'COMPLETE',
      item_name: '500 Tokens Package',
      amount_gross: '500.00',
      custom_str1: tenantId,
      custom_str2: 'marketplace',
      custom_str3: order._id.toString(),
      merchant_id: cfg.merchantId,
    };
    payload.signature = payfastService.generateSignature(payload, cfg.passphrase);
    
    // Process ITN
    const itnResult = await payfastService.processItnNotification(payload);
    assert.equal(itnResult.status, 200, 'ITN should process successfully');
    
    // 5. Verify Database Reconciliation
    const updatedOrder = await MarketplaceOrder.findById(order._id);
    const updatedPayment = await CommercePayment.findById(payment._id);
    const updatedInvoice = await Invoice.findById(invoice._id);
    const pfTx = await PayfastTransaction.findOne({ mPaymentId });
    
    assert.equal(updatedOrder.status, 'fulfilled', 'Order should be fulfilled');
    assert.equal(updatedPayment.status, 'succeeded', 'CommercePayment should be succeeded');
    assert.equal(updatedInvoice.status, 'paid', 'Invoice should be paid');
    assert.equal(pfTx.status, 'COMPLETE', 'PayfastTransaction should be COMPLETE');
    
    // 6. Verify Wallet Credit and WalletTransaction History
    wallet = await Wallet.findOne({ tenantId });
    assert.equal(wallet.availableTokens, 500, 'Wallet should have exact tokens credited');
    
    txns = await walletService.listTransactions(tenantId);
    assert.equal(txns.length, 1, 'Exactly one wallet transaction should be created');
    assert.equal(txns[0].tokens, 500, 'Transaction should record 500 tokens');
    assert.equal(txns[0].type, 'purchase', 'Transaction type should be purchase');
    assert.equal(txns[0].refId.toString(), order._id.toString(), 'Transaction refId should link to order');
    assert.equal(txns[0].tenantId.toString(), tenantId.toString(), 'Transaction tenantId should match');
    
    // 7. Verify Idempotency (Duplicate ITN)
    const duplicateItnResult = await payfastService.processItnNotification(payload);
    assert.equal(duplicateItnResult.status, 200, 'Duplicate ITN should return 200 OK');
    assert.equal(duplicateItnResult.message, 'Payfast ITN already processed (idempotent)');
    
    // Ensure wallet wasn't credited twice
    wallet = await Wallet.findOne({ tenantId });
    assert.equal(wallet.availableTokens, 500, 'Wallet balance should remain 500 after duplicate ITN');
    
    txns = await walletService.listTransactions(tenantId);
    assert.equal(txns.length, 1, 'Still only one wallet transaction should exist after duplicate ITN');
  });
});
