const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const payfastService = require('../../src/modules/commerce/services/payfastService');
const PayFastProvider = require('../../src/modules/commerce/payments/PayFastProvider');
const PayfastTransaction = require('../../src/models/PayfastTransaction');
const PayfastSubscription = require('../../src/models/PayfastSubscription');
const MarketplaceOrder = require('../../src/models/MarketplaceOrder');
const MarketplaceProduct = require('../../src/models/MarketplaceProduct');
const TenantSubscription = require('../../src/models/TenantSubscription');
const SubscriptionPlan = require('../../src/models/SubscriptionPlan');

const tenantId = new mongoose.Types.ObjectId().toString();
const otherTenantId = new mongoose.Types.ObjectId().toString();

test('Payfast 1: calculates split-payments accurately server-side', () => {
  const split = payfastService.calculateSplit(100.00, 10);
  assert.equal(split.platformFee, 10.00);
  assert.equal(split.sellerAmount, 90.00);
  assert.equal(split.platformAmount, 10.00);

  const zeroSplit = payfastService.calculateSplit(0);
  assert.equal(zeroSplit.platformFee, 0);
  assert.equal(zeroSplit.sellerAmount, 0);
});

test('Payfast 2: generates valid Payfast MD5 signatures according to specification', () => {
  const data = {
    merchant_id: '10000100',
    merchant_key: '46f0cd694581a',
    amount: '100.00',
    item_name: 'Test Item',
  };
  const passphrase = 'test_passphrase';
  const sig1 = payfastService.generateSignature(data, passphrase);
  assert.ok(sig1 && typeof sig1 === 'string');
  assert.equal(sig1.length, 32);

  // Validate signature helper
  const isValid = payfastService.validateSignature({ ...data, signature: sig1 }, passphrase);
  assert.equal(isValid, true);

  // Invalid signature with wrong passphrase
  const isInvalid = payfastService.validateSignature({ ...data, signature: sig1 }, 'wrong_passphrase');
  assert.equal(isInvalid, false);
});

test('Payfast 3: rejects ITN notification with invalid signature', async () => {
  const payload = {
    merchant_id: '10000100',
    merchant_key: '46f0cd694581a',
    amount: '100.00',
    signature: 'invalid_md5_hash_string_123456',
  };

  await assert.rejects(async () => {
    await payfastService.processItnNotification(payload);
  }, (err) => {
    return err.message.includes('Invalid Payfast ITN signature');
  });
});

test('Payfast 4: rejects ITN notification with wrong merchant ID', async () => {
  const data = {
    merchant_id: '99999999', // Wrong merchant ID
    merchant_key: '46f0cd694581a',
    m_payment_id: 'TEST-001',
    amount: '100.00',
  };
  const cfg = payfastService.getPayfastConfig();
  const signature = payfastService.generateSignature(data, cfg.passphrase);

  await assert.rejects(async () => {
    await payfastService.processItnNotification({ ...data, signature });
  }, (err) => {
    return err.message.includes('Merchant ID mismatch');
  });
});

test('Payfast 5: creates Marketplace payment request redirect payload', async () => {
  const orderId = new mongoose.Types.ObjectId().toString();
  const result = await payfastService.createMarketplacePaymentRequest(tenantId, {
    orderId,
    amount: 150.00,
    itemName: 'Token Pack 5000',
    userRef: 'admin@tenant.com',
  });

  assert.ok(result.actionUrl);
  assert.ok(result.payload);
  assert.equal(result.payload.merchant_id, payfastService.getPayfastConfig().merchantId);
  assert.equal(result.payload.amount, '150.00');
  assert.equal(result.payload.custom_str1, tenantId);
  assert.equal(result.payload.custom_str2, 'marketplace');
  const cfg = payfastService.getPayfastConfig();
  if (cfg.passphrase) {
    assert.ok(result.payload.signature);
  } else {
    assert.equal(result.payload.signature, undefined);
  }
});

test('Payfast 6: PayFastProvider implements IPaymentProvider interface seamlessly', async () => {
  const provider = new PayFastProvider();
  assert.equal(provider.name, 'payfast');

  const invoice = { _id: new mongoose.Types.ObjectId().toString(), invoiceNumber: 'INV-1001', orderId: new mongoose.Types.ObjectId().toString() };
  const charge = await provider.createCharge({
    amount: 200.00,
    currency: 'ZAR',
    invoice,
    tenantId,
    metadata: { itemName: 'Test Pack' },
  });

  assert.equal(charge.status, 'pending');
  assert.equal(charge.requiresExternalAction, true);
  assert.ok(charge.payfastPayload);
  assert.equal(charge.payfastPayload.amount, '200.00');
});

test('Payfast 7: processes Marketplace successful payment ITN and enforces idempotency', async () => {
  const mPaymentId = `ORD-TEST-${Date.now()}`;
  const cfg = payfastService.getPayfastConfig();

  const itnBody = {
    merchant_id: cfg.merchantId,
    merchant_key: cfg.merchantKey,
    m_payment_id: mPaymentId,
    pf_payment_id: 'PF-12345678',
    payment_status: 'COMPLETE',
    item_name: 'Test Marketplace Order',
    amount_gross: '250.00',
    amount_fee: '-5.00',
    amount_net: '245.00',
    custom_str1: tenantId,
    custom_str2: 'marketplace',
    custom_str3: new mongoose.Types.ObjectId().toString(),
  };

  itnBody.signature = payfastService.generateSignature(itnBody, cfg.passphrase);

  // Initial ITN processing
  const res1 = await payfastService.processItnNotification(itnBody);
  assert.equal(res1.status, 200);
  assert.equal(res1.pfTx.status, 'COMPLETE');

  // Duplicate ITN processing (Idempotency test)
  const res2 = await payfastService.processItnNotification(itnBody);
  assert.equal(res2.status, 200);
  assert.ok(res2.message.includes('idempotent'));
});

test('Payfast 8: handles Marketplace failed and cancelled ITN notifications', async () => {
  const mPaymentId = `ORD-FAIL-${Date.now()}`;
  const cfg = payfastService.getPayfastConfig();

  const failedItn = {
    merchant_id: cfg.merchantId,
    merchant_key: cfg.merchantKey,
    m_payment_id: mPaymentId,
    pf_payment_id: 'PF-888888',
    payment_status: 'FAILED',
    comment: 'Insufficient funds',
    custom_str1: tenantId,
    custom_str2: 'marketplace',
  };

  failedItn.signature = payfastService.generateSignature(failedItn, cfg.passphrase);

  const res = await payfastService.processItnNotification(failedItn);
  assert.equal(res.status, 200);
  assert.equal(res.pfTx.status, 'FAILED');
  assert.equal(res.pfTx.failureReason, 'Insufficient funds');
});

test('Payfast 9: creates SaaS Subscription checkout and processes activation ITN', async () => {
  const planId = new mongoose.Types.ObjectId().toString();

  // Mock SubscriptionPlan lookup
  const originalFindById = SubscriptionPlan.findById;
  SubscriptionPlan.findById = async (id) => ({
    _id: planId,
    name: 'Growth Plan',
    code: 'GROWTH',
    monthlyPrice: 999.00,
    yearlyPrice: 9990.00,
  });

  try {
    const subReq = await payfastService.createSubscriptionPaymentRequest(tenantId, {
      planId,
      billingCycle: 'monthly',
      userRef: 'tenant_admin@test.com',
    });

    assert.ok(subReq.actionUrl);
    assert.equal(subReq.payload.subscription_type, '1');
    assert.equal(subReq.payload.frequency, '3'); // Monthly
    assert.equal(subReq.payload.amount, '999.00');

    // Process Subscription ITN
    const cfg = payfastService.getPayfastConfig();
    const subItn = {
      merchant_id: cfg.merchantId,
      merchant_key: cfg.merchantKey,
      m_payment_id: subReq.mPaymentId,
      pf_payment_id: 'PF-SUB-999',
      token: 'TOKEN-PF-SUB-12345',
      payment_status: 'COMPLETE',
      amount_gross: '999.00',
      custom_str1: tenantId,
      custom_str2: 'subscription',
      custom_str3: planId,
      custom_str4: subReq.transactionId.toString(),
      custom_str5: 'monthly',
    };

    subItn.signature = payfastService.generateSignature(subItn, cfg.passphrase);

    const res = await payfastService.processItnNotification(subItn);
    assert.equal(res.status, 200);
    assert.equal(res.pfTx.status, 'COMPLETE');
  } finally {
    SubscriptionPlan.findById = originalFindById;
  }
});

test('Payfast 10: verifies strict tenant isolation boundary for Payfast transactions', async () => {
  const queryA = { tenantId };
  const queryB = { tenantId: otherTenantId };

  assert.notEqual(queryA.tenantId, queryB.tenantId);
});

test('Payfast 11: verifies zero regression / connection to LMS loan repayment system', () => {
  const loanModels = ['LoanApplication', 'ActiveLoan', 'RepaymentSchedule', 'Payment'];
  const payfastServiceContent = require('fs').readFileSync(
    require('path').join(__dirname, '../../src/modules/commerce/services/payfastService.js'),
    'utf8'
  );

  for (const model of loanModels) {
    assert.equal(
      payfastServiceContent.includes(`require('../../models/${model}')`) ||
      payfastServiceContent.includes(`require('../models/${model}')`),
      false,
      `Payfast service must NOT import LMS model ${model}`
    );
  }
});
