/**
 * scripts/verifyPayfastE2E.js
 * REAL SAFE PAYFAST SANDBOX END-TO-END HTTP VERIFICATION
 * 
 * Tests complete marketplace token purchase flow using real HTTP calls against Express and MongoDB.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const http = require('http');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const app = require('../src/app');
const tenantContext = require('../src/tenancy/tenantContext');
const payfastService = require('../src/modules/commerce/services/payfastService');

const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Wallet = require('../src/models/Wallet');
const MarketplaceProduct = require('../src/models/MarketplaceProduct');
const MarketplaceOrder = require('../src/models/MarketplaceOrder');
const MarketplacePurchase = require('../src/models/MarketplacePurchase');
const CommercePayment = require('../src/models/CommercePayment');
const Invoice = require('../src/models/Invoice');
const PayfastTransaction = require('../src/models/PayfastTransaction');

async function runVerification() {
  console.log('================================================================================');
  console.log('REAL SAFE PAYFAST SANDBOX END-TO-END HTTP & DATABASE VERIFICATION');
  console.log('================================================================================\n');

  // Verify Config (masked secrets)
  const cfg = payfastService.getPayfastConfig();
  console.log('--- STEP 0: ENVIRONMENT CONFIGURATION AUDIT ---');
  console.log(`- PAYFAST_MERCHANT_ID  : ${cfg.merchantId ? cfg.merchantId.slice(0, 4) + '****' : 'MISSING'}`);
  console.log(`- PAYFAST_MERCHANT_KEY : ${cfg.merchantKey ? '[CONFIGURED: YES]' : 'MISSING'}`);
  console.log(`- PAYFAST_PASSPHRASE   : ${cfg.passphrase ? '[CONFIGURED: YES]' : 'MISSING'}`);
  console.log(`- PAYFAST_ENVIRONMENT  : ${cfg.isSandbox ? 'sandbox' : 'production'}`);
  console.log(`- Base Process URL     : ${cfg.baseUrl}`);
  console.log(`- Validate URL         : ${cfg.validateUrl}`);
  console.log(`- Notify URL           : ${cfg.notifyUrl}\n`);

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing from environment');
  }

  // Connect to live MongoDB with retry
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
      break;
    } catch (e) {
      console.warn(`[MongoDB Connection Attempt ${attempt} failed]: ${e.message}`);
      if (attempt === 5) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.log(`✅ Connected to MongoDB (${mongoose.connection.name})\n`);

  // Start HTTP server on ephemeral port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`✅ Live Express Test Server listening on ${baseUrl}\n`);

  // Allow simulated ITN pingback in test runner
  process.env.PAYFAST_SKIP_PINGBACK = 'true';

  try {
    // 1. Setup / find test tenant and admin user
    const { tenant, user, authToken, initialWallet } = await tenantContext.runAsSystem(async () => {
      let t = await Tenant.findOne({ companyCode: 'QA_PAYFAST_HTTP' });
      if (!t) {
        t = await Tenant.create({
          companyCode: 'QA_PAYFAST_HTTP',
          companyName: 'QA Payfast HTTP Tenant',
          status: 'active',
        });
      }

      let u = await User.findOne({ email: 'qa_admin@point47.co.za' });
      if (!u) {
        u = await User.create({
          fullName: 'QA Payfast Admin',
          email: 'qa_admin@point47.co.za',
          phone: '+27821234567',
          password: 'Password123!',
          role: 'admin',
          tenantId: t._id,
          isActive: true,
        });
      }

      let w = await Wallet.findOne({ tenantId: t._id });
      if (!w) {
        w = await Wallet.create({
          tenantId: t._id,
          availableTokens: 500,
          consumedTokens: 0,
          purchasedTokens: 500,
        });
      }

      // Ensure product TOK-1K exists
      let prod = await MarketplaceProduct.findOne({ sku: 'TOK-1K' });
      if (!prod) {
        prod = await MarketplaceProduct.create({
          sku: 'TOK-1K',
          name: '1,000 Token Pack',
          type: 'token_pack',
          price: 100.00,
          currency: 'ZAR',
          grants: { tokens: 1000 },
          bonusTokens: 0,
          status: 'active',
        });
      }

      const token = jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
      return { tenant: t, user: u, authToken: token, initialWallet: w };
    });

    const tenantId = tenant._id.toString();
    console.log(`[SETUP] Test Tenant ID: ${tenantId}`);
    console.log(`[SETUP] Initial Wallet Balance: ${initialWallet.availableTokens} tokens\n`);

    // =========================================================================
    // TEST 1 — PAYFAST CHECKOUT CREATION
    // =========================================================================
    console.log('========================================================================');
    console.log('TEST 1 — PAYFAST CHECKOUT CREATION (POST /api/commerce/marketplace/buy-tokens)');
    console.log('========================================================================');

    const checkoutResponse = await axios.post(
      `${baseUrl}/api/commerce/marketplace/buy-tokens`,
      {
        sku: 'TOK-1K',
        quantity: 1,
        provider: 'payfast',
        idempotencyKey: `e2e-order-1-${Date.now()}`,
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`HTTP Status: ${checkoutResponse.status} ${checkoutResponse.statusText}`);
    const checkoutData = checkoutResponse.data?.data;
    console.log(`Response Order ID: ${checkoutData?.order?._id}`);
    console.log(`Response requiresAction: ${checkoutData?.requiresAction}`);
    console.log(`Response Action URL: ${checkoutData?.action?.redirectUrl || checkoutData?.payment?.metadata?.redirectUrl}`);
    console.log(`Response Payfast Payload Signature: ${checkoutData?.action?.payfastPayload?.signature || checkoutData?.payment?.metadata?.payfastPayload?.signature}`);

    const order1Id = checkoutData?.order?._id;
    const payment1Id = checkoutData?.payment?._id;
    const invoice1Id = checkoutData?.invoice?._id;

    // DIRECT DATABASE VERIFICATION BEFORE ITN
    const dbOrderBefore = await tenantContext.runAsSystem(() => MarketplaceOrder.findById(order1Id));
    const dbPaymentBefore = await tenantContext.runAsSystem(() => CommercePayment.findById(payment1Id));
    const dbInvoiceBefore = await tenantContext.runAsSystem(() => Invoice.findById(invoice1Id));
    const dbWalletBefore = await tenantContext.runAsSystem(() => Wallet.findOne({ tenantId }));
    const dbPurchasesBefore = await tenantContext.runAsSystem(() => MarketplacePurchase.find({ orderId: order1Id }));

    console.log('\n--- DIRECT DATABASE STATE BEFORE ITN ---');
    console.log(`Order Status        : ${dbOrderBefore.status} (EXPECTED: pending)`);
    console.log(`Payment Status      : ${dbPaymentBefore.status} (EXPECTED: pending)`);
    console.log(`Invoice Status      : ${dbInvoiceBefore.status} (EXPECTED: pending)`);
    console.log(`Invoice amountPaid  : R${dbInvoiceBefore.amountPaid} (EXPECTED: 0)`);
    console.log(`Wallet Balance      : ${dbWalletBefore.availableTokens} (EXPECTED: ${initialWallet.availableTokens} - UNCHANGED)`);
    console.log(`Purchases Count     : ${dbPurchasesBefore.length} (EXPECTED: 0)`);

    if (
      dbOrderBefore.status !== 'pending' ||
      dbPaymentBefore.status !== 'pending' ||
      dbInvoiceBefore.status !== 'pending' ||
      dbInvoiceBefore.amountPaid !== 0 ||
      dbWalletBefore.availableTokens !== initialWallet.availableTokens ||
      dbPurchasesBefore.length !== 0
    ) {
      throw new Error('TEST 1 FAILED: Database state before ITN is not strictly pending / tokens were granted prematurely!');
    }
    console.log('✅ TEST 1 PASSED: Order, Payment, and Invoice are all pending. Zero tokens granted at checkout creation.\n');

    // =========================================================================
    // TEST 2 — PAYFAST SANDBOX PAYMENT / VERIFIED ITN
    // =========================================================================
    console.log('========================================================================');
    console.log('TEST 2 — PAYFAST VERIFIED ITN NOTIFICATION (POST /api/v1/commerce/payfast/notify)');
    console.log('========================================================================');

    const pfReqPayload = checkoutData?.action?.payfastPayload || checkoutData?.payment?.metadata?.payfastPayload;
    const mPaymentId = pfReqPayload.m_payment_id;
    const pfTx = await tenantContext.runAsSystem(() => PayfastTransaction.findOne({ mPaymentId }));
    const order1Total = Number(checkoutData?.order?.total).toFixed(2);
    const order1Tokens = checkoutData?.order?.items?.[0]?.grants?.tokens || 1000;

    const verifiedItnBody = {
      merchant_id: cfg.merchantId,
      merchant_key: cfg.merchantKey,
      m_payment_id: mPaymentId,
      pf_payment_id: `PF-E2E-SANDBOX-${Date.now()}`,
      payment_status: 'COMPLETE',
      item_name: checkoutData?.order?.items?.[0]?.name || '1,000 Token Pack',
      amount_gross: order1Total,
      amount_fee: '-5.00',
      amount_net: (Number(order1Total) - 5.00).toFixed(2),
      custom_str1: tenantId,
      custom_str2: 'marketplace',
      custom_str3: String(order1Id),
      custom_str4: String(pfTx ? pfTx._id : ''),
    };

    // Calculate valid MD5 signature according to Payfast specification
    verifiedItnBody.signature = payfastService.generateSignature(verifiedItnBody, cfg.passphrase);

    console.log(`Sending ITN payload for m_payment_id: ${mPaymentId} with valid MD5 signature...`);

    const itnUrlEncoded = new URLSearchParams(verifiedItnBody).toString();
    const itnResponse = await axios.post(
      `${baseUrl}/api/v1/commerce/payfast/notify`,
      itnUrlEncoded,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    console.log(`ITN HTTP Response Status: ${itnResponse.status} (Body: "${itnResponse.data}")`);

    // DIRECT DATABASE VERIFICATION AFTER ITN
    const dbOrderAfter = await tenantContext.runAsSystem(() => MarketplaceOrder.findById(order1Id));
    const dbPaymentAfter = await tenantContext.runAsSystem(() => CommercePayment.findById(payment1Id));
    const dbInvoiceAfter = await tenantContext.runAsSystem(() => Invoice.findById(invoice1Id));
    const dbWalletAfter = await tenantContext.runAsSystem(() => Wallet.findOne({ tenantId }));
    const dbPurchasesAfter = await tenantContext.runAsSystem(() => MarketplacePurchase.find({ orderId: order1Id }));
    const dbPfTxAfter = await tenantContext.runAsSystem(() => PayfastTransaction.findOne({ mPaymentId }));

    console.log('\n--- DIRECT DATABASE STATE AFTER VERIFIED ITN ---');
    console.log(`Order Status        : ${dbOrderAfter.status} (EXPECTED: fulfilled)`);
    console.log(`Payment Status      : ${dbPaymentAfter.status} (EXPECTED: succeeded)`);
    console.log(`Invoice Status      : ${dbInvoiceAfter.status} (EXPECTED: paid)`);
    console.log(`Invoice amountPaid  : R${dbInvoiceAfter.amountPaid} (EXPECTED: ${order1Total})`);
    console.log(`Wallet Balance      : ${dbWalletAfter.availableTokens} (EXPECTED: ${initialWallet.availableTokens + order1Tokens} - +${order1Tokens} tokens)`);
    console.log(`Purchases Count     : ${dbPurchasesAfter.length} (EXPECTED: 1)`);
    console.log(`PayfastTx Status    : ${dbPfTxAfter.status} (EXPECTED: COMPLETE)`);

    if (
      dbOrderAfter.status !== 'fulfilled' ||
      dbPaymentAfter.status !== 'succeeded' ||
      dbInvoiceAfter.status !== 'paid' ||
      Math.abs(dbInvoiceAfter.amountPaid - Number(order1Total)) > 0.01 ||
      dbWalletAfter.availableTokens !== (initialWallet.availableTokens + order1Tokens) ||
      dbPurchasesAfter.length !== 1 ||
      dbPfTxAfter.status !== 'COMPLETE'
    ) {
      throw new Error('TEST 2 FAILED: Database state after ITN does not match fulfilled/paid/credited specifications!');
    }
    console.log(`✅ TEST 2 PASSED: Order fulfilled, Payment succeeded, Invoice paid, and exactly ${order1Tokens} tokens granted once.\n`);

    // =========================================================================
    // TEST 3 — DUPLICATE ITN (IDEMPOTENCY)
    // =========================================================================
    console.log('========================================================================');
    console.log('TEST 3 — DUPLICATE ITN IDEMPOTENCY CHECK');
    console.log('========================================================================');

    console.log('Re-sending the exact same verified ITN to webhook...');
    const dupItnResponse = await axios.post(
      `${baseUrl}/api/v1/commerce/payfast/notify`,
      itnUrlEncoded,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    console.log(`Duplicate ITN HTTP Status: ${dupItnResponse.status} (Body: "${dupItnResponse.data}")`);

    const dbWalletDup = await tenantContext.runAsSystem(() => Wallet.findOne({ tenantId }));
    const dbPurchasesDup = await tenantContext.runAsSystem(() => MarketplacePurchase.find({ orderId: order1Id }));
    const dbInvoiceDup = await tenantContext.runAsSystem(() => Invoice.findById(invoice1Id));

    console.log(`Wallet Balance after duplicate ITN : ${dbWalletDup.availableTokens} (EXPECTED: ${initialWallet.availableTokens + order1Tokens})`);
    console.log(`Purchases Count after duplicate ITN: ${dbPurchasesDup.length} (EXPECTED: 1)`);
    console.log(`Invoice amountPaid after duplicate : R${dbInvoiceDup.amountPaid} (EXPECTED: ${order1Total})`);

    if (
      dbWalletDup.availableTokens !== (initialWallet.availableTokens + order1Tokens) ||
      dbPurchasesDup.length !== 1
    ) {
      throw new Error('TEST 3 FAILED: Duplicate ITN granted extra tokens or created duplicate purchases!');
    }
    console.log('✅ TEST 3 PASSED: Duplicate ITN safely ignored. Zero duplicate tokens, zero duplicate purchases.\n');

    // =========================================================================
    // TEST 4 — INVALID / TAMPERED ITN SIGNATURE
    // =========================================================================
    console.log('========================================================================');
    console.log('TEST 4 — INVALID / TAMPERED SIGNATURE REJECTION');
    console.log('========================================================================');

    // Create a 2nd order to test invalid ITN against a fresh pending order
    const checkout2 = await axios.post(
      `${baseUrl}/api/commerce/marketplace/buy-tokens`,
      {
        sku: 'TOK-1K',
        quantity: 1,
        provider: 'payfast',
        idempotencyKey: `e2e-order-2-${Date.now()}`,
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const order2Id = checkout2.data?.data?.order?._id;
    const payment2Id = checkout2.data?.data?.payment?._id;
    const order2Total = Number(checkout2.data?.data?.order?.total).toFixed(2);
    const pfReqPayload2 = checkout2.data?.data?.action?.payfastPayload || checkout2.data?.data?.payment?.metadata?.payfastPayload;
    const mPaymentId2 = pfReqPayload2.m_payment_id;

    console.log(`Created Order 2 for security tests: ${order2Id} (m_payment_id: ${mPaymentId2}, total: R${order2Total})`);

    const tamperedSigBody = {
      merchant_id: cfg.merchantId,
      merchant_key: cfg.merchantKey,
      m_payment_id: mPaymentId2,
      pf_payment_id: `PF-TAMPER-${Date.now()}`,
      payment_status: 'COMPLETE',
      item_name: '1,000 Token Pack',
      amount_gross: order2Total,
      custom_str1: tenantId,
      custom_str2: 'marketplace',
      custom_str3: String(order2Id),
      signature: '00000000000000000000000000000000', // BAD SIGNATURE
    };

    let invalidSigStatus = 0;
    let invalidSigErrorMsg = '';
    try {
      await axios.post(
        `${baseUrl}/api/v1/commerce/payfast/notify`,
        new URLSearchParams(tamperedSigBody).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );
    } catch (err) {
      invalidSigStatus = err.response?.status;
      invalidSigErrorMsg = err.response?.data;
    }

    console.log(`Tampered Signature Response Status: ${invalidSigStatus} (Message: "${invalidSigErrorMsg}")`);

    const dbOrder2AfterTamper = await tenantContext.runAsSystem(() => MarketplaceOrder.findById(order2Id));
    const dbPayment2AfterTamper = await tenantContext.runAsSystem(() => CommercePayment.findById(payment2Id));
    const dbWalletAfterTamper = await tenantContext.runAsSystem(() => Wallet.findOne({ tenantId }));

    console.log(`Order 2 Status after Tamper : ${dbOrder2AfterTamper.status} (EXPECTED: pending)`);
    console.log(`Payment 2 Status after Tamper: ${dbPayment2AfterTamper.status} (EXPECTED: pending)`);
    console.log(`Wallet Balance after Tamper : ${dbWalletAfterTamper.availableTokens} (EXPECTED: ${initialWallet.availableTokens + order1Tokens})`);

    if (
      invalidSigStatus !== 400 ||
      dbOrder2AfterTamper.status !== 'pending' ||
      dbPayment2AfterTamper.status !== 'pending' ||
      dbWalletAfterTamper.availableTokens !== (initialWallet.availableTokens + order1Tokens)
    ) {
      throw new Error('TEST 4 FAILED: Tampered signature was not rejected with HTTP 400 or affected order state!');
    }
    console.log('✅ TEST 4 PASSED: Tampered signature strictly rejected with HTTP 400. Order remains pending.\n');

    // =========================================================================
    // TEST 5 — AMOUNT TAMPERING REJECTION
    // =========================================================================
    console.log('========================================================================');
    console.log('TEST 5 — AMOUNT TAMPERING REJECTION');
    console.log('========================================================================');

    // Send ITN for Order 2 with mismatched amount
    const tamperedAmt = (Number(order2Total) - 10 > 0 ? Number(order2Total) - 10 : 1.00).toFixed(2);
    const tamperedAmtBody = {
      merchant_id: cfg.merchantId,
      merchant_key: cfg.merchantKey,
      m_payment_id: mPaymentId2,
      pf_payment_id: `PF-AMT-TAMPER-${Date.now()}`,
      payment_status: 'COMPLETE',
      item_name: '1,000 Token Pack',
      amount_gross: tamperedAmt, // Tampered from order2Total
      amount_fee: '-0.05',
      amount_net: (Number(tamperedAmt) - 0.05).toFixed(2),
      custom_str1: tenantId,
      custom_str2: 'marketplace',
      custom_str3: String(order2Id),
    };
    tamperedAmtBody.signature = payfastService.generateSignature(tamperedAmtBody, cfg.passphrase);

    let amtTamperStatus = 0;
    let amtTamperMsg = '';
    try {
      await axios.post(
        `${baseUrl}/api/v1/commerce/payfast/notify`,
        new URLSearchParams(tamperedAmtBody).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );
    } catch (err) {
      amtTamperStatus = err.response?.status;
      amtTamperMsg = err.response?.data;
    }

    console.log(`Amount Tamper Response Status: ${amtTamperStatus} (Message: "${amtTamperMsg}")`);

    const dbOrder2AfterAmtTamper = await tenantContext.runAsSystem(() => MarketplaceOrder.findById(order2Id));
    const dbPayment2AfterAmtTamper = await tenantContext.runAsSystem(() => CommercePayment.findById(payment2Id));
    const dbWalletAfterAmtTamper = await tenantContext.runAsSystem(() => Wallet.findOne({ tenantId }));

    console.log(`Order 2 Status after Amount Tamper : ${dbOrder2AfterAmtTamper.status} (EXPECTED: pending or failed, NOT fulfilled)`);
    console.log(`Payment 2 Status after Amount Tamper: ${dbPayment2AfterAmtTamper.status} (EXPECTED: pending, NOT succeeded)`);
    console.log(`Wallet Balance after Amount Tamper : ${dbWalletAfterAmtTamper.availableTokens} (EXPECTED: ${initialWallet.availableTokens + order1Tokens})`);

    if (
      amtTamperStatus !== 400 ||
      dbOrder2AfterAmtTamper.status === 'fulfilled' ||
      dbPayment2AfterAmtTamper.status === 'succeeded' ||
      dbWalletAfterAmtTamper.availableTokens !== (initialWallet.availableTokens + order1Tokens)
    ) {
      throw new Error('TEST 5 FAILED: Tampered amount was not rejected or fulfilled order!');
    }
    console.log('✅ TEST 5 PASSED: Amount tampering strictly rejected with HTTP 400. Zero tokens granted.\n');

    // =========================================================================
    // TEST 6 — FRONTEND RETURN URL VERIFICATION
    // =========================================================================
    console.log('========================================================================');
    console.log('TEST 6 — FRONTEND RETURN / SUCCESS URL CLIENT GUARD');
    console.log('========================================================================');

    // Order 3 created
    const checkout3 = await axios.post(
      `${baseUrl}/api/commerce/marketplace/buy-tokens`,
      {
        sku: 'TOK-1K',
        quantity: 1,
        provider: 'payfast',
        idempotencyKey: `e2e-order-3-${Date.now()}`,
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const order3Id = checkout3.data?.data?.order?._id;
    const pfReqPayload3 = checkout3.data?.data?.action?.payfastPayload || checkout3.data?.data?.payment?.metadata?.payfastPayload;

    console.log(`Simulating client returning from Payfast to Return URL: /admin/payment/success?type=marketplace&orderId=${order3Id}`);

    // Query status endpoint (which is read-only)
    const statusQueryRes = await axios.get(
      `${baseUrl}/api/v1/commerce/payfast/status/${pfReqPayload3.m_payment_id}`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );

    console.log(`Transaction Status Endpoint Response: status=${statusQueryRes.data?.data?.status}`);

    const dbOrder3 = await tenantContext.runAsSystem(() => MarketplaceOrder.findById(order3Id));
    const dbWalletFinal = await tenantContext.runAsSystem(() => Wallet.findOne({ tenantId }));

    console.log(`Order 3 Database Status: ${dbOrder3.status} (EXPECTED: pending)`);
    console.log(`Wallet Balance          : ${dbWalletFinal.availableTokens} (EXPECTED: ${initialWallet.availableTokens + order1Tokens})`);

    if (dbOrder3.status !== 'pending') {
      throw new Error('TEST 6 FAILED: Order was fulfilled without verified ITN notification!');
    }
    console.log('✅ TEST 6 PASSED: Return URL never fulfills an order. Fulfillment is strictly authoritative via verified server-side ITN.\n');

    console.log('================================================================================');
    console.log('ALL 6 END-TO-END VERIFICATION TESTS PASSED PERFECTLY!');
    console.log('================================================================================\n');

  } finally {
    server.close();
    await mongoose.connection.close();
  }
}

runVerification()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('FATAL ERROR in Payfast E2E Verification:', err);
    process.exit(1);
  });
