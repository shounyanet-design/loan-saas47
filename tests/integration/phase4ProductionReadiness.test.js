require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CollectionAttempt = require('../../src/models/CollectionAttempt');
const RepaymentSchedule = require('../../src/models/RepaymentSchedule');
const ActiveLoan = require('../../src/models/ActiveLoan');
const Borrower = require('../../src/models/Borrower');
const Payment = require('../../src/models/Payment');
const Tenant = require('../../src/models/Tenant');
const tenantContext = require('../../src/tenancy/tenantContext');

const loanCollectionService = require('../../src/modules/loanCollection/loanCollectionService');
const payFastTokenizationService = require('../../src/modules/loanCollection/payFastTokenizationService');
const collectionDispatcher = require('../../src/modules/loanCollection/collectionDispatcher');
const realpayService = require('../../src/services/realpay/realpayService');
const payfastService = require('../../src/modules/commerce/services/payfastService');
const { handleRealPayWebhook } = require('../../src/controllers/realpayWebhookController');

describe('PHASE 4 — LOAN COLLECTION PRODUCTION READINESS & PROVIDER INTEGRATION', () => {
  let mongoServer;
  let tenantA_id;
  let tenantB_id;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    await CollectionAttempt.syncIndexes();

    tenantA_id = new mongoose.Types.ObjectId();
    tenantB_id = new mongoose.Types.ObjectId();

    await tenantContext.runAsSystem(async () => {
      await Tenant.create([
        { _id: tenantA_id, companyName: 'Tenant A ProdReady', companyCode: `TENA-${Date.now()}`, status: 'active' },
        { _id: tenantB_id, companyName: 'Tenant B ProdReady', companyCode: `TENB-${Date.now()}`, status: 'active' }
      ]);
    });
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  async function createFixture(tenantId, options = {}) {
    return tenantContext.runWithTenant(tenantId, async () => {
      const borrower = await Borrower.create({
        fullName: options.fullName || 'Phase4 Borrower',
        email: `p4-${Date.now()}-${Math.random()}@point47.co.za`,
        phoneNumber: '+27821234567',
        password: 'Password123!',
        idNumber: options.idNumber || `850101${Math.floor(1000000 + Math.random() * 9000000)}`,
        collectionProfile: {
          collectionMethod: 'DEBICHECK',
          debicheckMandateReference: options.mandateRef || 'RPM-PHASE4-MANDATE-001',
          payfastTokenReference: options.payfastToken !== undefined ? options.payfastToken : null,
          tokenStatus: options.tokenStatus || (options.payfastToken ? 'ACTIVE' : 'NOT_CONFIGURED'),
          authorizationStatus: options.tokenStatus || (options.payfastToken ? 'ACTIVE' : 'NOT_CONFIGURED')
        }
      });

      const loan = await ActiveLoan.create({
        borrowerId: borrower._id,
        borrowerName: borrower.fullName,
        borrowerEmail: borrower.email,
        borrowerPhone: borrower.phoneNumber,
        borrowerIdNumber: borrower.idNumber,
        loanApplicationId: new mongoose.Types.ObjectId(),
        loanCode: options.loanCode || `LN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        approvedAmount: 10000,
        interestRate: 15,
        loanDurationMonths: 6,
        emiAmount: options.amount || 1750,
        totalPayableAmount: 10500,
        remainingBalance: 10500,
        principalAmount: 10000,
        balanceRemaining: 10500,
        loanStatus: 'Active',
        disbursedDate: new Date(),
        debicheckMandateReference: options.mandateRef || 'RPM-PHASE4-MANDATE-001'
      });

      const schedule = await RepaymentSchedule.create({
        loanId: loan._id,
        borrowerId: borrower._id,
        emiNumber: options.emiNumber || 1,
        dueDate: options.dueDate || new Date(),
        amount: options.amount || 1750,
        principalComponent: 1500,
        interestComponent: 250,
        status: 'Pending',
        amountPaid: 0
      });

      return { borrower, loan, schedule };
    });
  }

  function mockWebhookRequest(body) {
    let statusCode = null;
    let jsonBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonBody = data;
        return this;
      }
    };
    return {
      req: { body, headers: {} },
      res,
      getStatus: () => statusCode,
      getData: () => jsonBody
    };
  }

  // =========================================================================
  // SCENARIO 1: First EMI -> RealPay -> SUCCESSFUL -> Paid
  // =========================================================================
  it('Scenario 1: First EMI -> RealPay -> SUCCESSFUL -> Paid', async () => {
    const { borrower, loan, schedule } = await createFixture(tenantA_id, { emiNumber: 1, amount: 1750 });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const dispatchRes = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);
      assert.strictEqual(dispatchRes.success, true);
      assert.strictEqual(dispatchRes.collectionAttempt.collectionMethod, 'DEBICHECK');
      assert.strictEqual(dispatchRes.collectionAttempt.provider, 'REALPAY');
      assert.strictEqual(dispatchRes.collectionAttempt.emiNumber, 1);
      assert.strictEqual(String(dispatchRes.collectionAttempt.activeLoanId), String(loan._id));

      const mock = mockWebhookRequest({
        ContractSequence: dispatchRes.collectionAttempt.providerReference,
        InstalmentStatusCode: 'S',
        InstalmentResult: 'SUCC',
        InstalmentAmount: 1750
      });
      await handleRealPayWebhook(mock.req, mock.res);

      assert.strictEqual(mock.getStatus(), 200);
      const updatedSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(updatedSchedule.status, 'Paid');
      assert.strictEqual(updatedSchedule.amountPaid, 1750);

      const collPayments = await Payment.find({ transactionId: `TX-COLL-${dispatchRes.collectionAttempt._id}` });
      assert.strictEqual(collPayments.length, 1);
    });
  });

  // =========================================================================
  // SCENARIO 2: Normal EMI -> RealPay -> TRACKING -> remains unpaid
  // =========================================================================
  it('Scenario 2: Normal EMI -> RealPay -> TRACKING -> remains unpaid', async () => {
    const { schedule } = await createFixture(tenantA_id, { emiNumber: 2, amount: 1750 });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const dispatchRes = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);

      const mock = mockWebhookRequest({
        ContractSequence: dispatchRes.collectionAttempt.providerReference,
        InstalmentStatusCode: 'P',
        InstalmentResult: 'PEND'
      });
      await handleRealPayWebhook(mock.req, mock.res);

      assert.strictEqual(mock.getStatus(), 200);
      const updatedAttempt = await CollectionAttempt.findById(dispatchRes.collectionAttempt._id);
      assert.strictEqual(updatedAttempt.status, 'TRACKING');

      const updatedSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(updatedSchedule.status, 'Pending');
      assert.strictEqual(updatedSchedule.amountPaid, 0);

      // Assert zero payments and zero PayFast fallbacks
      const payments = await Payment.find({ transactionId: `TX-COLL-${dispatchRes.collectionAttempt._id}` });
      assert.strictEqual(payments.length, 0);

      const fallbacks = await CollectionAttempt.find({ originalAttemptId: dispatchRes.collectionAttempt._id });
      assert.strictEqual(fallbacks.length, 0);
    });
  });

  // =========================================================================
  // SCENARIO 3: TRACKING x4 -> remains unpaid -> no PayFast
  // =========================================================================
  it('Scenario 3: TRACKING x4 -> remains unpaid -> no PayFast', async () => {
    const { schedule } = await createFixture(tenantA_id, { emiNumber: 3, amount: 1750 });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const dispatchRes = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);

      for (let i = 1; i <= 4; i++) {
        const mock = mockWebhookRequest({
          ContractSequence: dispatchRes.collectionAttempt.providerReference,
          InstalmentStatusCode: 'P',
          InstalmentResult: 'PEND'
        });
        await handleRealPayWebhook(mock.req, mock.res);
        assert.strictEqual(mock.getStatus(), 200);
      }

      const updatedAttempt = await CollectionAttempt.findById(dispatchRes.collectionAttempt._id);
      assert.strictEqual(updatedAttempt.status, 'TRACKING');

      const updatedSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(updatedSchedule.status, 'Pending');

      const fallbacks = await CollectionAttempt.find({ originalAttemptId: dispatchRes.collectionAttempt._id });
      assert.strictEqual(fallbacks.length, 0);
    });
  });

  // =========================================================================
  // SCENARIO 4: RealPay -> UNSUCCESSFUL -> immediate PayFast fallback
  // =========================================================================
  it('Scenario 4: RealPay -> UNSUCCESSFUL -> immediate PayFast fallback', async () => {
    const { schedule } = await createFixture(tenantA_id, {
      emiNumber: 4,
      amount: 1750,
      payfastToken: 'PF-TOKEN-P4-VALID',
      tokenStatus: 'ACTIVE'
    });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const dispatchRes = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);

      const mock = mockWebhookRequest({
        ContractSequence: dispatchRes.collectionAttempt.providerReference,
        InstalmentStatusCode: 'F',
        InstalmentResult: 'FAIL',
        FailureDescription: 'Insufficient funds'
      });
      await handleRealPayWebhook(mock.req, mock.res);

      assert.strictEqual(mock.getStatus(), 200);

      // Verify RealPay attempt is UNSUCCESSFUL
      const updatedRealPay = await CollectionAttempt.findById(dispatchRes.collectionAttempt._id);
      assert.strictEqual(updatedRealPay.status, 'UNSUCCESSFUL');
      assert.strictEqual(updatedRealPay.fallbackStatus, 'TRIGGERED');
      assert.ok(updatedRealPay.fallbackAttemptId);

      // Verify PayFast fallback attempt exists and links originalAttemptId
      const fallbackAttempt = await CollectionAttempt.findById(updatedRealPay.fallbackAttemptId);
      assert.ok(fallbackAttempt);
      assert.strictEqual(fallbackAttempt.collectionMethod, 'PAYFAST_CARD');
      assert.strictEqual(fallbackAttempt.provider, 'PAYFAST');
      assert.strictEqual(String(fallbackAttempt.originalAttemptId), String(dispatchRes.collectionAttempt._id));
      assert.strictEqual(fallbackAttempt.emiNumber, 4);
    });
  });

  // =========================================================================
  // SCENARIO 5: RealPay -> UNSUCCESSFUL -> PayFast token missing -> no charge -> EMI remains unpaid
  // =========================================================================
  it('Scenario 5: RealPay -> UNSUCCESSFUL -> PayFast token missing -> no charge -> EMI remains unpaid', async () => {
    const { schedule } = await createFixture(tenantA_id, {
      emiNumber: 5,
      amount: 1750,
      payfastToken: null,
      tokenStatus: 'NOT_CONFIGURED'
    });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const dispatchRes = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);

      const mock = mockWebhookRequest({
        ContractSequence: dispatchRes.collectionAttempt.providerReference,
        InstalmentStatusCode: 'F',
        InstalmentResult: 'FAIL'
      });
      await handleRealPayWebhook(mock.req, mock.res);

      assert.strictEqual(mock.getStatus(), 200);

      const fallbackAttempt = await CollectionAttempt.findOne({ originalAttemptId: dispatchRes.collectionAttempt._id });
      assert.ok(fallbackAttempt);
      assert.strictEqual(fallbackAttempt.status, 'FAILED');
      assert.strictEqual(fallbackAttempt.fallbackStatus, 'NOT_CONFIGURED');

      const updatedSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(updatedSchedule.status, 'Pending');
      assert.strictEqual(updatedSchedule.amountPaid, 0);

      const payments = await Payment.find({ repaymentScheduleId: schedule._id });
      assert.strictEqual(payments.length, 0);
    });
  });

  // =========================================================================
  // SCENARIO 6: RealPay -> UNSUCCESSFUL -> valid PayFast token -> PayFast SUCCESSFUL -> EMI Paid
  // =========================================================================
  it('Scenario 6: RealPay -> UNSUCCESSFUL -> valid PayFast token -> PayFast SUCCESSFUL -> EMI Paid', async () => {
    const { schedule } = await createFixture(tenantA_id, {
      emiNumber: 6,
      amount: 1750,
      payfastToken: 'PF-TOKEN-ACTIVE-SCN6',
      tokenStatus: 'ACTIVE'
    });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const dispatchRes = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);

      const mock = mockWebhookRequest({
        ContractSequence: dispatchRes.collectionAttempt.providerReference,
        InstalmentStatusCode: 'F',
        InstalmentResult: 'FAIL'
      });
      await handleRealPayWebhook(mock.req, mock.res);

      const updatedSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(updatedSchedule.status, 'Paid');
      assert.strictEqual(updatedSchedule.amountPaid, 1750);

      const fallbackAttempt = await CollectionAttempt.findOne({ originalAttemptId: dispatchRes.collectionAttempt._id });
      assert.strictEqual(fallbackAttempt.status, 'SUCCESSFUL');

      const payments = await Payment.find({ transactionId: `TX-COLL-${fallbackAttempt._id}` });
      assert.strictEqual(payments.length, 1);
    });
  });

  // =========================================================================
  // SCENARIO 7: RealPay -> UNSUCCESSFUL -> PayFast FAILED -> EMI remains unpaid
  // =========================================================================
  it('Scenario 7: RealPay -> UNSUCCESSFUL -> PayFast FAILED -> EMI remains unpaid', async () => {
    const { schedule } = await createFixture(tenantA_id, {
      emiNumber: 7,
      amount: 1750,
      payfastToken: 'PF-TOKEN-FAIL-SCN7',
      tokenStatus: 'ACTIVE'
    });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const dispatchRes = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);

      const mock = mockWebhookRequest({
        ContractSequence: dispatchRes.collectionAttempt.providerReference,
        InstalmentStatusCode: 'F',
        InstalmentResult: 'FAIL'
      });
      await handleRealPayWebhook(mock.req, mock.res);

      const updatedSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(updatedSchedule.status, 'Pending');

      const fallbackAttempt = await CollectionAttempt.findOne({ originalAttemptId: dispatchRes.collectionAttempt._id });
      assert.strictEqual(fallbackAttempt.status, 'FAILED');
      assert.strictEqual(fallbackAttempt.fallbackStatus, 'EXHAUSTED');

      const payments = await Payment.find({ repaymentScheduleId: schedule._id });
      assert.strictEqual(payments.length, 0);
    });
  });

  // =========================================================================
  // SCENARIO 8: RealPay -> SUCCESSFUL -> duplicate SUCCESSFUL webhook -> exactly 1 Payment
  // =========================================================================
  it('Scenario 8: RealPay -> SUCCESSFUL -> duplicate SUCCESSFUL webhook -> exactly 1 Payment', async () => {
    const { schedule } = await createFixture(tenantA_id, { emiNumber: 8, amount: 1750 });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const dispatchRes = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);

      const body = {
        ContractSequence: dispatchRes.collectionAttempt.providerReference,
        InstalmentStatusCode: 'S',
        InstalmentResult: 'SUCC',
        InstalmentAmount: 1750
      };

      // First webhook
      const mock1 = mockWebhookRequest(body);
      await handleRealPayWebhook(mock1.req, mock1.res);
      assert.strictEqual(mock1.getStatus(), 200);

      // Duplicate webhook
      const mock2 = mockWebhookRequest(body);
      await handleRealPayWebhook(mock2.req, mock2.res);
      assert.strictEqual(mock2.getStatus(), 200);
      assert.strictEqual(mock2.getData().data.resSucc.isDuplicate, true);

      const payments = await Payment.find({ transactionId: `TX-COLL-${dispatchRes.collectionAttempt._id}` });
      assert.strictEqual(payments.length, 1);
    });
  });

  // =========================================================================
  // SCENARIO 9: RealPay -> UNSUCCESSFUL -> duplicate UNSUCCESSFUL webhook -> exactly 1 PayFast fallback
  // =========================================================================
  it('Scenario 9: RealPay -> UNSUCCESSFUL -> duplicate UNSUCCESSFUL webhook -> exactly 1 PayFast fallback', async () => {
    const { schedule } = await createFixture(tenantA_id, {
      emiNumber: 9,
      amount: 1750,
      payfastToken: 'PF-TOKEN-VALID-SCN9',
      tokenStatus: 'ACTIVE'
    });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const dispatchRes = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);

      const body = {
        ContractSequence: dispatchRes.collectionAttempt.providerReference,
        InstalmentStatusCode: 'F',
        InstalmentResult: 'FAIL'
      };

      // First failure webhook
      const mock1 = mockWebhookRequest(body);
      await handleRealPayWebhook(mock1.req, mock1.res);
      assert.strictEqual(mock1.getStatus(), 200);

      // Duplicate failure webhook
      const mock2 = mockWebhookRequest(body);
      await handleRealPayWebhook(mock2.req, mock2.res);
      assert.strictEqual(mock2.getStatus(), 200);
      assert.strictEqual(mock2.getData().data.resFail.isDuplicate, true);

      const fallbacks = await CollectionAttempt.find({ originalAttemptId: dispatchRes.collectionAttempt._id });
      assert.strictEqual(fallbacks.length, 1);
    });
  });

  // =========================================================================
  // SCENARIO 10: TRACKING -> timeout -> NO PayFast
  // =========================================================================
  it('Scenario 10: TRACKING -> timeout -> NO PayFast', async () => {
    const { schedule } = await createFixture(tenantA_id, { emiNumber: 10, amount: 1750 });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const dispatchRes = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);

      const mock = mockWebhookRequest({
        ContractSequence: dispatchRes.collectionAttempt.providerReference,
        InstalmentStatusCode: 'P',
        InstalmentResult: 'PEND'
      });
      await handleRealPayWebhook(mock.req, mock.res);

      // Simulate timeout (30 days pass)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await CollectionAttempt.updateOne({ _id: dispatchRes.collectionAttempt._id }, { trackingAt: thirtyDaysAgo });

      const fallbacks = await CollectionAttempt.find({ originalAttemptId: dispatchRes.collectionAttempt._id });
      assert.strictEqual(fallbacks.length, 0);

      const updatedSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(updatedSchedule.status, 'Pending');
    });
  });

  // =========================================================================
  // SCENARIO 11: No webhook -> NO PayFast
  // =========================================================================
  it('Scenario 11: No webhook -> NO PayFast', async () => {
    const { schedule } = await createFixture(tenantA_id, { emiNumber: 11, amount: 1750 });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const dispatchRes = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);

      // No webhook is received
      const fallbacks = await CollectionAttempt.find({ originalAttemptId: dispatchRes.collectionAttempt._id });
      assert.strictEqual(fallbacks.length, 0);

      const payments = await Payment.find({ repaymentScheduleId: schedule._id });
      assert.strictEqual(payments.length, 0);
    });
  });

  // =========================================================================
  // SCENARIO 12: Cron retry -> NO PayFast
  // =========================================================================
  it('Scenario 12: Cron retry -> NO PayFast', async () => {
    const { schedule } = await createFixture(tenantA_id, { emiNumber: 12, amount: 1750 });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const dispatchRes = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);

      // Run collection dispatcher again for today
      const dispatchAgain = await collectionDispatcher.dispatchDueCollectionsForTenant(tenantA_id, new Date());

      const skipped = dispatchAgain.find(d => String(d.repaymentScheduleId) === String(schedule._id));
      assert.ok(skipped);
      assert.strictEqual(skipped.status, 'SKIPPED');
      assert.strictEqual(skipped.reason, 'ACTIVE_ATTEMPT_EXISTS');

      const fallbacks = await CollectionAttempt.find({ originalAttemptId: dispatchRes.collectionAttempt._id });
      assert.strictEqual(fallbacks.length, 0);
    });
  });

  // =========================================================================
  // SCENARIO 13: Wrong amount -> rejected
  // =========================================================================
  it('Scenario 13: Wrong amount -> rejected', async () => {
    const { schedule } = await createFixture(tenantA_id, { emiNumber: 13, amount: 1750 });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const dispatchRes = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);

      const mock = mockWebhookRequest({
        ContractSequence: dispatchRes.collectionAttempt.providerReference,
        InstalmentStatusCode: 'S',
        InstalmentResult: 'SUCC',
        InstalmentAmount: 1500 // Expected 1750, sent 1500
      });
      await handleRealPayWebhook(mock.req, mock.res);

      assert.strictEqual(mock.getStatus(), 400);
      assert.strictEqual(mock.getData().code, 'COLLECTION_AMOUNT_MISMATCH');

      const updatedSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(updatedSchedule.status, 'Pending');
      assert.strictEqual(updatedSchedule.amountPaid, 0);
    });
  });

  // =========================================================================
  // SCENARIO 14: Tenant A cannot access Tenant B collection
  // =========================================================================
  it('Scenario 14: Tenant A cannot access Tenant B collection', async () => {
    const fixtureA = await createFixture(tenantA_id, { emiNumber: 14, amount: 1750 });
    const fixtureB = await createFixture(tenantB_id, { emiNumber: 14, amount: 1750 });

    let attemptA;
    let attemptB;

    await tenantContext.runWithTenant(tenantA_id, async () => {
      attemptA = (await loanCollectionService.submitPrimaryCollection(fixtureA.schedule._id, tenantA_id)).collectionAttempt;
    });

    await tenantContext.runWithTenant(tenantB_id, async () => {
      attemptB = (await loanCollectionService.submitPrimaryCollection(fixtureB.schedule._id, tenantB_id)).collectionAttempt;
    });

    // Tenant A queries collections
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const attemptsVisibleToA = await CollectionAttempt.find({});
      assert.strictEqual(attemptsVisibleToA.some(a => String(a._id) === String(attemptB._id)), false);
      const attemptBDirect = await CollectionAttempt.findOne({ _id: attemptB._id });
      assert.strictEqual(attemptBDirect, null);
    });

    // Tenant B queries collections
    await tenantContext.runWithTenant(tenantB_id, async () => {
      const attemptsVisibleToB = await CollectionAttempt.find({});
      assert.strictEqual(attemptsVisibleToB.some(a => String(a._id) === String(attemptA._id)), false);
      const attemptADirect = await CollectionAttempt.findOne({ _id: attemptA._id });
      assert.strictEqual(attemptADirect, null);
    });
  });

  // =========================================================================
  // SCENARIO 15: Existing Marketplace PayFast still works
  // =========================================================================
  it('Scenario 15: Existing Marketplace PayFast still works', async () => {
    const marketplacePayload = {
      tenantId: tenantA_id,
      orderId: new mongoose.Types.ObjectId(),
      amount: 500,
      items: [{ name: 'Credit Report Package', amount: 500 }],
      userRef: 'USR-TEST-001'
    };
    const reqData = await payfastService.createMarketplacePaymentRequest(tenantA_id, marketplacePayload);
    assert.ok(reqData.actionUrl);
    assert.ok(reqData.payload.m_payment_id);
    assert.strictEqual(reqData.payload.custom_str2, 'marketplace');
  });

  // =========================================================================
  // SCENARIO 16: Existing SaaS PayFast still works
  // =========================================================================
  it('Scenario 16: Existing SaaS PayFast still works', async () => {
    const planId = new mongoose.Types.ObjectId();
    const reqData = await payfastService.createSubscriptionPaymentRequest(tenantA_id, {
      planId,
      billingCycle: 'monthly',
      userRef: 'ADMIN-TEST-001'
    });
    assert.ok(reqData.actionUrl);
    assert.ok(reqData.payload.m_payment_id);
    assert.strictEqual(reqData.payload.custom_str2, 'subscription');
  });

  // =========================================================================
  // SCENARIO 17: Existing RealPay mandate still works
  // =========================================================================
  it('Scenario 17: Existing RealPay mandate still works', async () => {
    assert.strictEqual(typeof realpayService.initiateMandate, 'function');
    assert.strictEqual(typeof realpayService.getMandateStatus, 'function');
    assert.strictEqual(typeof realpayService.cancelMandate, 'function');
    assert.strictEqual(typeof realpayService.ensureRealPayClient, 'function');
  });

  // =========================================================================
  // ADDITIONAL PHASE 4 VALIDATION: PayFast Tokenization Flow & Isolation
  // =========================================================================
  it('Phase 4 Bonus: Borrower card tokenization flow authorizes token without storing raw card data', async () => {
    const { borrower } = await createFixture(tenantA_id, { payfastToken: null, tokenStatus: 'NOT_CONFIGURED' });

    await tenantContext.runWithTenant(tenantA_id, async () => {
      // 1. Create authorization request
      const authReq = await payFastTokenizationService.createBorrowerCardAuthorizationRequest(tenantA_id, borrower._id);
      assert.ok(authReq.payload);
      assert.strictEqual(authReq.payload.subscription_type, '2'); // Ad-Hoc tokenization
      assert.strictEqual(authReq.payload.custom_str2, 'LOAN_TOKENIZATION');

      // 2. Process ITN callback
      const cfg = payfastService.getPayfastConfig();
      const itnCallback = {
        merchant_id: cfg.merchantId,
        custom_str1: String(tenantA_id),
        custom_str2: 'LOAN_TOKENIZATION',
        custom_str3: String(borrower._id),
        payment_status: 'COMPLETE',
        token: 'PF-TOKEN-CARD-SECURE-9988'
      };
      itnCallback.signature = payfastService.generateSignature(itnCallback, cfg.passphrase);

      const itnResult = await payfastService.processItnNotification(itnCallback);
      assert.strictEqual(itnResult.success, true);
      assert.strictEqual(itnResult.tokenStatus, 'ACTIVE');

      const updatedBorrower = await Borrower.findById(borrower._id);
      assert.strictEqual(updatedBorrower.collectionProfile.payfastTokenReference, 'PF-TOKEN-CARD-SECURE-9988');
      assert.strictEqual(updatedBorrower.collectionProfile.tokenStatus, 'ACTIVE');
      assert.ok(updatedBorrower.collectionProfile.authorizedAt);

      // Verify ZERO raw card details stored
      const borrowerObj = updatedBorrower.toObject();
      assert.strictEqual(borrowerObj.cardNumber, undefined);
      assert.strictEqual(borrowerObj.cvv, undefined);
      assert.strictEqual(borrowerObj.cardExpiry, undefined);
    });
  });
});
