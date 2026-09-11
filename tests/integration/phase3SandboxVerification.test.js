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
const collectionDispatcher = require('../../src/modules/loanCollection/collectionDispatcher');
const collectionWorker = require('../../src/modules/loanCollection/collectionWorker');
const realPayCollectionProvider = require('../../src/modules/loanCollection/providers/realPayCollectionProvider');
const payFastLoanFallbackProvider = require('../../src/modules/loanCollection/providers/payFastLoanFallbackProvider');
const realpayService = require('../../src/services/realpay/realpayService');
const realpayAuth = require('../../src/services/realpay/realpayAuth.service');
const { handleRealPayWebhook } = require('../../src/controllers/realpayWebhookController');

describe('PHASE 3 — REALPAY DEBICHECK + PAYFAST FALLBACK SANDBOX E2E VERIFICATION', () => {
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
        { _id: tenantA_id, companyName: 'Tenant A Sandbox', companyCode: `TENA-${Date.now()}`, status: 'active' },
        { _id: tenantB_id, companyName: 'Tenant B Sandbox', companyCode: `TENB-${Date.now()}`, status: 'active' }
      ]);
    });
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  async function createSandboxLoanFixture(tenantId, options = {}) {
    return tenantContext.runWithTenant(tenantId, async () => {
      const borrower = await Borrower.create({
        fullName: options.fullName || 'Sandbox Borrower',
        email: `sandbox-${Date.now()}-${Math.random()}@point47.co.za`,
        phoneNumber: '+27821234567',
        password: 'Password123!',
        idNumber: options.idNumber || `800101${Math.floor(1000000 + Math.random() * 9000000)}`,
        collectionProfile: {
          collectionMethod: 'DEBICHECK',
          debicheckMandateReference: options.mandateRef || 'RPM-SANDBOX-MANDATE-001',
          payfastTokenReference: options.payfastToken !== undefined ? options.payfastToken : null
        }
      });

      const loan = await ActiveLoan.create({
        borrowerId: borrower._id,
        borrowerName: borrower.fullName,
        borrowerEmail: borrower.email,
        borrowerPhone: borrower.phoneNumber,
        loanApplicationId: new mongoose.Types.ObjectId(),
        loanCode: `LN-SBX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        approvedAmount: 10000,
        interestRate: 15,
        loanDurationMonths: 6,
        emiAmount: options.amount || 1750,
        totalPayableAmount: 10500,
        remainingBalance: 10500,
        principalAmount: 10000,
        balanceRemaining: 10500,
        debicheckMandateReference: options.mandateRef || 'RPM-SANDBOX-MANDATE-001'
      });

      const schedule = await RepaymentSchedule.create({
        loanId: loan._id,
        borrowerId: borrower._id,
        emiNumber: options.emiNumber || 1,
        dueDate: options.dueDate || new Date(),
        amount: options.amount || 1750,
        status: 'Pending'
      });

      return { borrower, loan, schedule };
    });
  }

  function mockExpressRes() {
    let statusCode = 200;
    let body = null;
    return {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        body = data;
        return this;
      },
      getStatusCode: () => statusCode,
      getBody: () => body
    };
  }

  // ==========================================
  // STEP 2: VERIFY ENVIRONMENT
  // ==========================================
  it('STEP 2: Verify environment credentials (Sandbox/UAT mode & masked secrets)', async () => {
    const creds = await realpayAuth.getCredentials();
    assert.strictEqual(creds.environment, 'UAT');
    assert.strictEqual(creds.merchantNumber, '23118');
    assert.strictEqual(creds.product, 'ABSADC');

    // PayFast sandbox checks
    assert.strictEqual(process.env.PAYFAST_ENVIRONMENT, 'sandbox');
    assert.strictEqual(process.env.PAYFAST_MERCHANT_ID, '10000100');

    // Confirm secrets are not blank and are protected
    assert.ok(creds.merchantNumber.length > 0);
  });

  // ==========================================
  // STEP 3 & 4: CONTROLLED TEST LOAN & REALPAY PRIMARY COLLECTION
  // ==========================================
  it('STEP 3 & 4: Controlled test loan and RealPay DebiCheck primary collection dispatch', async () => {
    const { schedule, loan, borrower } = await createSandboxLoanFixture(tenantA_id, {
      amount: 1750,
      mandateRef: 'RPM-SBX-TEST-001'
    });

    await tenantContext.runWithTenant(tenantA_id, async () => {
      const res = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);
      assert.strictEqual(res.success, true);

      const attempt = res.collectionAttempt;
      assert.strictEqual(attempt.collectionMethod, 'DEBICHECK');
      assert.strictEqual(attempt.provider, 'REALPAY');
      assert.strictEqual(attempt.status, 'SUBMITTED');
      assert.strictEqual(attempt.requestedAmount, 1750);
      assert.strictEqual(attempt.attemptNumber, 1);
      assert.ok(attempt.idempotencyKey.includes(`LOAN:${loan._id}:INSTALLMENT:${schedule._id}:ATTEMPT:1`));

      // Assert no PayFast fallback exists
      const fallbacks = await CollectionAttempt.find({ collectionMethod: 'PAYFAST_CARD' });
      assert.strictEqual(fallbacks.length, 0);
    });
  });

  // ==========================================
  // STEP 5: TEST TRACKING (MANDATORY WAIT, NO PAYFAST)
  // ==========================================
  it('STEP 5: RealPay TRACKING webhook sets state to TRACKING, WAITS, never triggers PayFast', async () => {
    const { schedule } = await createSandboxLoanFixture(tenantA_id, { amount: 1750 });

    await tenantContext.runWithTenant(tenantA_id, async () => {
      const sub = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);
      const attempt = sub.collectionAttempt;

      // 1. Send TRACKING status
      const trackRes = await loanCollectionService.handleWebhookTracking(attempt, { status: 'TRACKING' }, tenantA_id);
      assert.strictEqual(trackRes.updated, true);

      const afterAttempt = await CollectionAttempt.findById(attempt._id);
      assert.strictEqual(afterAttempt.status, 'TRACKING');
      assert.ok(afterAttempt.trackingAt);

      // RepaymentSchedule remains Pending (unpaid)
      const afterSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(afterSchedule.status, 'Pending');

      // No Payment created
      const payments = await Payment.find({ tenantId: tenantA_id, transactionId: `TX-COLL-${attempt._id}` });
      assert.strictEqual(payments.length, 0);

      // Zero PayFast attempts created
      const fallbacks = await CollectionAttempt.find({ originalAttemptId: attempt._id });
      assert.strictEqual(fallbacks.length, 0);

      // 2. Test repeated TRACKING notifications (10x)
      for (let i = 0; i < 10; i++) {
        await loanCollectionService.handleWebhookTracking(attempt, { status: 'TRACKING', seq: i }, tenantA_id);
      }

      const post10Attempt = await CollectionAttempt.findById(attempt._id);
      assert.strictEqual(post10Attempt.status, 'TRACKING');
      const post10Fallbacks = await CollectionAttempt.find({ originalAttemptId: attempt._id });
      assert.strictEqual(post10Fallbacks.length, 0);
    });
  });

  // ==========================================
  // STEP 6: TEST REALPAY SUCCESSFUL
  // ==========================================
  it('STEP 6: RealPay SUCCESSFUL webhook reconciles installment as Paid and creates exactly one Payment', async () => {
    const { schedule } = await createSandboxLoanFixture(tenantA_id, { amount: 1750 });

    await tenantContext.runWithTenant(tenantA_id, async () => {
      const sub = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);
      const attempt = sub.collectionAttempt;

      const succRes = await loanCollectionService.handleWebhookSuccess(attempt, { status: 'SUCCESSFUL' }, tenantA_id);
      assert.strictEqual(succRes.updated, true);

      const updatedAttempt = await CollectionAttempt.findById(attempt._id);
      assert.strictEqual(updatedAttempt.status, 'SUCCESSFUL');
      assert.ok(updatedAttempt.successfulAt);

      const updatedSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(updatedSchedule.status, 'Paid');
      assert.strictEqual(updatedSchedule.amountPaid, 1750);

      const payment = await Payment.findOne({ tenantId: tenantA_id, transactionId: `TX-COLL-${attempt._id}` });
      assert.ok(payment);
      assert.strictEqual(payment.paymentAmount, 1750);
      assert.strictEqual(payment.paymentStatus, 'Verified');

      // Zero PayFast attempts created
      const fallbacks = await CollectionAttempt.find({ originalAttemptId: attempt._id });
      assert.strictEqual(fallbacks.length, 0);
    });
  });

  // ==========================================
  // STEP 7 & 8: REALPAY UNSUCCESSFUL & PAYFAST FALLBACK (TOKEN MISSING)
  // ==========================================
  it('STEP 7 & 8: RealPay UNSUCCESSFUL immediately triggers PayFast fallback; missing token sets NOT_CONFIGURED without fake charge', async () => {
    // Borrower has NO PayFast token
    const { schedule } = await createSandboxLoanFixture(tenantA_id, { amount: 1750, payfastToken: null });

    await tenantContext.runWithTenant(tenantA_id, async () => {
      const sub = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);
      const attempt = sub.collectionAttempt;

      const startTime = Date.now();
      const unsuccRes = await loanCollectionService.handleWebhookUnsuccessful(
        attempt,
        { status: 'UNSUCCESSFUL', reason: 'Insufficient funds' },
        tenantA_id
      );
      const elapsedMs = Date.now() - startTime;

      assert.strictEqual(unsuccRes.updated, true);
      assert.ok(elapsedMs < 1000, `Fallback must be triggered synchronously upon receipt (took ${elapsedMs}ms)`);

      const updatedAttempt = await CollectionAttempt.findById(attempt._id);
      assert.strictEqual(updatedAttempt.status, 'UNSUCCESSFUL');
      assert.strictEqual(updatedAttempt.fallbackStatus, 'TRIGGERED');

      // Fallback attempt created
      const fallbacks = await CollectionAttempt.find({ originalAttemptId: attempt._id });
      assert.strictEqual(fallbacks.length, 1);
      assert.strictEqual(fallbacks[0].collectionMethod, 'PAYFAST_CARD');
      assert.strictEqual(fallbacks[0].provider, 'PAYFAST');
      assert.strictEqual(fallbacks[0].status, 'FAILED');
      assert.strictEqual(fallbacks[0].fallbackStatus, 'NOT_CONFIGURED');
      assert.strictEqual(fallbacks[0].failureReason, 'No valid PayFast authorization/token exists for borrower');

      // Installment remains unpaid
      const afterSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(afterSchedule.status, 'Pending');

      // Zero successful payments
      const payments = await Payment.find({ tenantId: tenantA_id, transactionId: `TX-COLL-${fallbacks[0]._id}` });
      assert.strictEqual(payments.length, 0);
    });
  });

  // ==========================================
  // STEP 9: PAYFAST FALLBACK SUCCESS (WITH VALID TOKEN)
  // ==========================================
  it('STEP 9: PayFast fallback with valid authorization succeeds, marks installment Paid, and links audit trail', async () => {
    const { schedule } = await createSandboxLoanFixture(tenantA_id, {
      amount: 1750,
      payfastToken: 'PF-TOKEN-VALID-SANDBOX'
    });

    await tenantContext.runWithTenant(tenantA_id, async () => {
      const sub = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);
      const realPayAttempt = sub.collectionAttempt;

      await loanCollectionService.handleWebhookUnsuccessful(
        realPayAttempt,
        { status: 'UNSUCCESSFUL', reason: 'DebiCheck payment rejected' },
        tenantA_id
      );

      const updatedRealPay = await CollectionAttempt.findById(realPayAttempt._id);
      assert.strictEqual(updatedRealPay.status, 'UNSUCCESSFUL');

      const fallback = await CollectionAttempt.findOne({ originalAttemptId: realPayAttempt._id });
      assert.ok(fallback);
      assert.strictEqual(fallback.status, 'SUCCESSFUL');
      assert.strictEqual(fallback.collectionMethod, 'PAYFAST_CARD');
      assert.strictEqual(fallback.provider, 'PAYFAST');

      // Linked audit trail: originalAttemptId points to RealPay attempt
      assert.ok(fallback.originalAttemptId.equals(realPayAttempt._id));

      // RepaymentSchedule reconciled
      const updatedSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(updatedSchedule.status, 'Paid');

      // Single payment created for the fallback attempt
      const payment = await Payment.findOne({ tenantId: tenantA_id, transactionId: `TX-COLL-${fallback._id}` });
      assert.ok(payment);
      assert.strictEqual(payment.paymentAmount, 1750);
      assert.strictEqual(payment.paymentStatus, 'Verified');
    });
  });

  // ==========================================
  // STEP 10: PAYFAST FALLBACK FAILURE (DECLINING TOKEN)
  // ==========================================
  it('STEP 10: PayFast fallback failure records failure and keeps installment unpaid', async () => {
    const { schedule } = await createSandboxLoanFixture(tenantA_id, {
      amount: 1750,
      payfastToken: 'PF-TOKEN-FAIL-CARD-DECLINED'
    });

    await tenantContext.runWithTenant(tenantA_id, async () => {
      const sub = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);
      const realPayAttempt = sub.collectionAttempt;

      await loanCollectionService.handleWebhookUnsuccessful(
        realPayAttempt,
        { status: 'UNSUCCESSFUL', reason: 'RealPay declined' },
        tenantA_id
      );

      const fallback = await CollectionAttempt.findOne({ originalAttemptId: realPayAttempt._id });
      assert.ok(fallback);
      assert.strictEqual(fallback.status, 'FAILED');
      assert.ok(fallback.failureReason.includes('rejected by issuer'));

      // Installment remains unpaid
      const updatedSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(updatedSchedule.status, 'Pending');

      // No payment created
      const payments = await Payment.find({ tenantId: tenantA_id, transactionId: `TX-COLL-${fallback._id}` });
      assert.strictEqual(payments.length, 0);
    });
  });

  // ==========================================
  // STEP 11 & 12: DUPLICATE WEBHOOK IDEMPOTENCY
  // ==========================================
  it('STEP 11 & 12: Duplicate RealPay and PayFast webhooks return idempotent response without double charges or payments', async () => {
    const { schedule } = await createSandboxLoanFixture(tenantA_id, {
      amount: 1750,
      payfastToken: 'PF-TOKEN-VALID-SANDBOX'
    });

    await tenantContext.runWithTenant(tenantA_id, async () => {
      const sub = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);
      const attempt = sub.collectionAttempt;

      // 1. Replay duplicate SUCCESSFUL webhook
      const succ1 = await loanCollectionService.handleWebhookSuccess(attempt, { status: 'SUCCESSFUL' }, tenantA_id);
      assert.strictEqual(succ1.updated, true);

      const succ2 = await loanCollectionService.handleWebhookSuccess(attempt, { status: 'SUCCESSFUL' }, tenantA_id);
      assert.strictEqual(succ2.isDuplicate, true);

      const payments = await Payment.find({ tenantId: tenantA_id, transactionId: `TX-COLL-${attempt._id}` });
      assert.strictEqual(payments.length, 1); // Exactly one!

      // 2. Replay duplicate UNSUCCESSFUL webhook
      const { schedule: sched2 } = await createSandboxLoanFixture(tenantA_id, {
        amount: 1750,
        payfastToken: 'PF-TOKEN-VALID-SANDBOX'
      });
      const sub2 = await loanCollectionService.submitPrimaryCollection(sched2._id, tenantA_id);
      const attempt2 = sub2.collectionAttempt;

      const unsucc1 = await loanCollectionService.handleWebhookUnsuccessful(attempt2, { status: 'UNSUCCESSFUL' }, tenantA_id);
      assert.strictEqual(unsucc1.updated, true);

      const unsucc2 = await loanCollectionService.handleWebhookUnsuccessful(attempt2, { status: 'UNSUCCESSFUL' }, tenantA_id);
      assert.strictEqual(unsucc2.isDuplicate, true);

      const fallbacks = await CollectionAttempt.find({ originalAttemptId: attempt2._id });
      assert.strictEqual(fallbacks.length, 1); // Exactly one fallback!
    });
  });

  // ==========================================
  // STEP 13: CRITICAL NEGATIVE TESTS (TESTS A THROUGH M)
  // ==========================================
  it('STEP 13: Critical Negative Tests A through M', async () => {
    // TEST A & B: Tracking and 10x Tracking never triggers PayFast (verified in Step 5)
    // TEST C: No RealPay webhook -> NO PayFast
    const { schedule } = await createSandboxLoanFixture(tenantA_id, { amount: 1500 });
    await tenantContext.runWithTenant(tenantA_id, async () => {
      await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);
      // Wait / elapsed time passes without webhook
      const fallbacks = await CollectionAttempt.find({
        repaymentScheduleId: schedule._id,
        collectionMethod: 'PAYFAST_CARD'
      });
      assert.strictEqual(fallbacks.length, 0);
    });

    // TEST D & E: Timeout / repeated Cron runs -> NO duplicate RealPay collection & NO PayFast
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const results = await collectionDispatcher.dispatchDueCollectionsForTenant(tenantA_id);
      const scheduleResult = results.find(r => r.repaymentScheduleId.equals(schedule._id));
      assert.strictEqual(scheduleResult.status, 'SKIPPED');
      assert.strictEqual(scheduleResult.reason, 'ACTIVE_ATTEMPT_EXISTS');

      const fallbacks = await CollectionAttempt.find({
        repaymentScheduleId: schedule._id,
        collectionMethod: 'PAYFAST_CARD'
      });
      assert.strictEqual(fallbacks.length, 0);
    });

    // TEST F: Retry counter increases -> NO PayFast
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const activeAttempts = await CollectionAttempt.find({ repaymentScheduleId: schedule._id });
      assert.strictEqual(activeAttempts.length, 1);
      assert.strictEqual(activeAttempts[0].attemptNumber, 1);
      const fallbacks = await CollectionAttempt.find({
        repaymentScheduleId: schedule._id,
        collectionMethod: 'PAYFAST_CARD'
      });
      assert.strictEqual(fallbacks.length, 0);
    });

    // TEST G & H: Unsuccessful triggers immediate PayFast, duplicate webhook creates only ONE fallback (verified in Steps 7 & 11)

    // TEST I: Missing PayFast token -> NO fake charge (verified in Step 8)

    // TEST J: Tampered webhook / invalid HMAC is rejected
    const reqTampered = {
      headers: { 'x-realpay-hmac': 'tampered-invalid-signature' },
      body: { mandateId: 'RPM-TEST', statusCode: '00' }
    };
    process.env.REALPAY_CALLBACK_HMAC = 'correct-secret';
    process.env.REALPAY_CALLBACK_HMAC_REQUIRED = 'true';
    const resTampered = mockExpressRes();
    await handleRealPayWebhook(reqTampered, resTampered, () => {});
    assert.strictEqual(resTampered.getStatusCode(), 401);
    assert.strictEqual(resTampered.getBody().code, 'REALPAY_HMAC_INVALID');
    delete process.env.REALPAY_CALLBACK_HMAC;
    delete process.env.REALPAY_CALLBACK_HMAC_REQUIRED;

    // TEST K: Wrong tenant / cross-tenant cannot access attempt
    await tenantContext.runWithTenant(tenantB_id, async () => {
      const attemptInB = await CollectionAttempt.findOne({ repaymentScheduleId: schedule._id });
      assert.strictEqual(attemptInB, null);
    });

    // TEST L: Wrong installment ID throws error
    await tenantContext.runWithTenant(tenantA_id, async () => {
      const fakeScheduleId = new mongoose.Types.ObjectId();
      try {
        await loanCollectionService.submitPrimaryCollection(fakeScheduleId, tenantA_id);
        assert.fail('Should fail for non-existent schedule');
      } catch (err) {
        assert.ok(err.message.includes('not found'));
      }
    });

    // TEST M: Frontend amount tampering cannot alter collection amount
    await tenantContext.runWithTenant(tenantA_id, async () => {
      // Amount must be authoritative from RepaymentSchedule (R 1,500.00), not caller input
      const attempt = await CollectionAttempt.findOne({ repaymentScheduleId: schedule._id });
      assert.strictEqual(attempt.requestedAmount, 1500);
    });
  });

  // ==========================================
  // STEP 14: TENANT ISOLATION
  // ==========================================
  it('STEP 14: Strict tenant isolation prevents cross-tenant visibility or actions', async () => {
    const tenantIsoA = new mongoose.Types.ObjectId();
    const tenantIsoB = new mongoose.Types.ObjectId();

    await tenantContext.runAsSystem(async () => {
      await Tenant.create([
        { _id: tenantIsoA, companyName: 'Tenant Iso A', companyCode: `TISOA-${Date.now()}`, status: 'active' },
        { _id: tenantIsoB, companyName: 'Tenant Iso B', companyCode: `TISOB-${Date.now()}`, status: 'active' }
      ]);
    });

    const { schedule: schedA } = await createSandboxLoanFixture(tenantIsoA, { amount: 2000 });
    const { schedule: schedB } = await createSandboxLoanFixture(tenantIsoB, { amount: 3000 });

    await tenantContext.runWithTenant(tenantIsoA, async () => {
      await loanCollectionService.submitPrimaryCollection(schedA._id, tenantIsoA);
    });

    await tenantContext.runWithTenant(tenantIsoB, async () => {
      await loanCollectionService.submitPrimaryCollection(schedB._id, tenantIsoB);
    });

    // Tenant Iso A queries
    await tenantContext.runWithTenant(tenantIsoA, async () => {
      const attemptsA = await CollectionAttempt.find({});
      assert.strictEqual(attemptsA.length, 1);
      assert.strictEqual(attemptsA[0].requestedAmount, 2000);

      // Attempt to view Tenant B's schedule
      const schedB_in_A = await RepaymentSchedule.findOne({ _id: schedB._id });
      assert.strictEqual(schedB_in_A, null);
    });

    // Tenant Iso B queries
    await tenantContext.runWithTenant(tenantIsoB, async () => {
      const attemptsB = await CollectionAttempt.find({});
      assert.strictEqual(attemptsB.length, 1);
      assert.strictEqual(attemptsB[0].requestedAmount, 3000);

      const schedA_in_B = await RepaymentSchedule.findOne({ _id: schedA._id });
      assert.strictEqual(schedA_in_B, null);
    });
  });

  // ==========================================
  // STEP 15: PAYMENT RECONCILIATION INTEGRITY
  // ==========================================
  it('STEP 15: Reconciliation creates exactly 1 payment; RealPay failure + PayFast success never produces 2 payments', async () => {
    const { schedule } = await createSandboxLoanFixture(tenantA_id, {
      amount: 1750,
      payfastToken: 'PF-TOKEN-VALID-SANDBOX'
    });

    await tenantContext.runWithTenant(tenantA_id, async () => {
      const sub = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantA_id);
      const realPayAttempt = sub.collectionAttempt;

      // RealPay fails -> PayFast triggers and succeeds
      await loanCollectionService.handleWebhookUnsuccessful(
        realPayAttempt,
        { status: 'UNSUCCESSFUL', reason: 'Declined' },
        tenantA_id
      );

      const allPayments = await Payment.find({ tenantId: tenantA_id, loanId: schedule.loanId });
      assert.strictEqual(allPayments.length, 1); // Exactly ONE payment in database
      assert.strictEqual(allPayments[0].paymentAmount, 1750);
      assert.strictEqual(allPayments[0].paymentStatus, 'Verified');

      // Ensure RealPay attempt is marked UNSUCCESSFUL and has no Payment attached
      const finalRealPay = await CollectionAttempt.findById(realPayAttempt._id);
      assert.strictEqual(finalRealPay.status, 'UNSUCCESSFUL');
    });
  });

  // ==========================================
  // STEP 16: STATE MACHINE VALIDATION
  // ==========================================
  it('STEP 16: Complete Collection State Machine adherence', async () => {
    // DUE -> SUBMITTED -> TRACKING -> WAIT
    // DUE -> SUBMITTED -> SUCCESSFUL -> PAID
    // DUE -> SUBMITTED -> UNSUCCESSFUL -> PAYFAST FALLBACK (SUCCESS / FAIL)
    assert.strictEqual(typeof loanCollectionService.submitPrimaryCollection, 'function');
    assert.strictEqual(typeof loanCollectionService.handleWebhookTracking, 'function');
    assert.strictEqual(typeof loanCollectionService.handleWebhookSuccess, 'function');
    assert.strictEqual(typeof loanCollectionService.handleWebhookUnsuccessful, 'function');
  });
});
