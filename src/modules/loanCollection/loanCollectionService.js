const CollectionAttempt = require('../../models/CollectionAttempt');
const RepaymentSchedule = require('../../models/RepaymentSchedule');
const collectionRules = require('./collectionRules');
const debitOrderProvider = require('../../services/payments/debitOrderProvider');
const payFastLoanFallbackProvider = require('./providers/payFastLoanFallbackProvider');
const collectionReconciliation = require('./collectionReconciliation');

class LoanCollectionService {
  /**
   * Submit primary DebiCheck collection for a repayment schedule.
   */
  async submitPrimaryCollection(repaymentScheduleId, tenantId) {
    // 0. Feature flag guard (Safe production defaults)
    const isEngineEnabled = process.env.LOAN_COLLECTION_ENABLED === 'true' || process.env.NODE_ENV === 'test';
    if (!isEngineEnabled) {
      return { success: false, reason: 'LOAN_COLLECTION_DISABLED_BY_FLAG' };
    }

    // 1. Validate eligibility
    const eligibility = await collectionRules.validatePrimaryEligibility(repaymentScheduleId, tenantId);
    if (!eligibility.eligible) {
      return { success: false, reason: eligibility.reason };
    }

    const { schedule, borrower, loan, mandateRef, amount } = eligibility;

    // Determine attempt number
    const existingCount = await CollectionAttempt.countDocuments({
      tenantId,
      repaymentScheduleId,
      collectionMethod: 'DEBICHECK'
    });
    const attemptNumber = existingCount + 1;

    const idempotencyKey = `LOAN:${loan._id}:INSTALLMENT:${schedule._id}:ATTEMPT:${attemptNumber}`;

    // 2. Create CollectionAttempt record
    const attempt = await CollectionAttempt.create({
      tenantId,
      borrowerId: borrower._id,
      loanId: loan._id,
      activeLoanId: loan._id,
      repaymentScheduleId: schedule._id,
      installmentIdentifier: `EMI-${schedule.emiNumber}`,
      emiNumber: schedule.emiNumber,
      collectionMethod: 'DEBICHECK',
      provider: 'NUPAY',
      attemptNumber,
      status: 'SUBMITTED',
      requestedAmount: amount,
      amount,
      idempotencyKey,
      submittedAt: new Date()
    });

    console.log(`[COLLECTION_CREATED] Attempt ${attempt._id} created for schedule ${schedule._id} (Tenant: ${tenantId})`);

    // 3. Submit collection to NuPay
    const result = await debitOrderProvider.createCollection({
      mandateId: mandateRef,
      amount,
      clientReference: idempotencyKey
    }, tenantId);

    if (result.outcome === 'ACCEPTED' || result.success || result.status === 'SUBMITTED') {
      attempt.providerReference = result.providerReference || result.mandateId || result.clientReference;
      await attempt.save();
      console.log(`[COLLECTION_SUBMITTED] Submitted attempt ${attempt._id} to NuPay (Ref: ${attempt.providerReference})`);
      return { success: true, collectionAttempt: attempt };
    } else {
      attempt.status = 'FAILED';
      attempt.failureReason = result.failureReason || result.providerMessage || 'NuPay submission failed';
      attempt.completedAt = new Date();
      await attempt.save();
      console.error(`[COLLECTION_FAILED] Attempt ${attempt._id} submission failed: ${attempt.failureReason}`);
      return { success: false, collectionAttempt: attempt, reason: attempt.failureReason };
    }
  }

  /**
   * Handle Webhook TRACKING status notification from NuPay.
   */
  async handleWebhookTracking(collectionAttempt, payload = {}, tenantId) {
    if (collectionAttempt.status === 'SUCCESSFUL' || collectionAttempt.status === 'SUCCESS') {
      return { updated: false, reason: 'ATTEMPT_ALREADY_SUCCESSFUL' };
    }

    collectionAttempt.status = 'TRACKING';
    collectionAttempt.trackingAt = new Date();
    collectionAttempt.metadata = { ...collectionAttempt.metadata, trackingWebhook: payload };
    await collectionAttempt.save();

    console.log(`[NUPAY_TRACKING] CollectionAttempt ${collectionAttempt._id} set to TRACKING state. Waiting for final outcome.`);
    return { updated: true, collectionAttempt };
  }

  /**
   * Handle Webhook SUCCESSFUL status notification from NuPay.
   */
  async handleWebhookSuccess(collectionAttempt, payload = {}, tenantId) {
    if (collectionAttempt.status === 'SUCCESSFUL' || collectionAttempt.status === 'SUCCESS') {
      return { updated: false, isDuplicate: true, collectionAttempt };
    }

    collectionAttempt.status = 'SUCCESSFUL';
    collectionAttempt.successfulAt = new Date();
    collectionAttempt.completedAt = new Date();
    collectionAttempt.metadata = { ...collectionAttempt.metadata, successWebhook: payload };
    await collectionAttempt.save();

    console.log(`[NUPAY_SUCCESSFUL] CollectionAttempt ${collectionAttempt._id} marked SUCCESSFUL.`);

    // Reconcile installment
    const reconc = await collectionReconciliation.reconcileSuccessfulCollection({
      collectionAttempt,
      tenantId
    });

    console.log(`[COLLECTION_RECONCILED] RepaymentSchedule ${collectionAttempt.repaymentScheduleId} marked Paid.`);
    return { updated: true, collectionAttempt, reconciliation: reconc };
  }

  /**
   * Handle Webhook UNSUCCESSFUL status notification from NuPay.
   * THIS IS THE ONLY TRIGGER FOR PAYFAST FALLBACK.
   */
  async handleWebhookUnsuccessful(collectionAttempt, payload = {}, tenantId) {
    if (collectionAttempt.status === 'UNSUCCESSFUL' || collectionAttempt.status === 'FAILED') {
      return { updated: false, isDuplicate: true, collectionAttempt };
    }

    const failureReason = payload.reason || payload.description || 'NuPay collection unsuccessful';

    collectionAttempt.status = 'UNSUCCESSFUL';
    collectionAttempt.failureReason = failureReason;
    collectionAttempt.unsuccessfulAt = new Date();
    collectionAttempt.completedAt = new Date();
    collectionAttempt.fallbackStatus = 'ELIGIBLE';
    collectionAttempt.metadata = { ...collectionAttempt.metadata, failureWebhook: payload };
    await collectionAttempt.save();

    console.log(`[NUPAY_UNSUCCESSFUL] CollectionAttempt ${collectionAttempt._id} marked UNSUCCESSFUL. Triggering PayFast fallback.`);

    // Immediately trigger isolated PayFast fallback
    const fallbackResult = await this.triggerPayFastFallback(collectionAttempt._id, tenantId);

    return { updated: true, collectionAttempt, fallbackResult };
  }

  /**
   * Initiate isolated PayFast fallback for a failed primary collection attempt.
   */
  async triggerPayFastFallback(primaryAttemptId, tenantId) {
    const primaryAttempt = await CollectionAttempt.findOne({ _id: primaryAttemptId, tenantId });
    if (!primaryAttempt) {
      throw new Error(`CollectionAttempt ${primaryAttemptId} not found`);
    }

    // Confirm schedule is still unpaid
    const schedule = await RepaymentSchedule.findOne({ _id: primaryAttempt.repaymentScheduleId, tenantId });
    if (!schedule || schedule.status === 'Paid') {
      return { triggered: false, reason: 'INSTALLMENT_ALREADY_PAID' };
    }

    // Check if fallback already created (prevent double fallback)
    const existingFallback = await CollectionAttempt.findOne({
      tenantId,
      originalAttemptId: primaryAttempt._id,
      collectionMethod: 'PAYFAST_CARD'
    });

    if (existingFallback) {
      console.warn(`[PAYFAST_FALLBACK_DUPLICATE] Fallback attempt already exists for attempt ${primaryAttempt._id}`);
      return { triggered: false, isDuplicate: true, fallbackAttempt: existingFallback };
    }

    const Borrower = require('../../models/Borrower');
    const borrower = await Borrower.findOne({ _id: primaryAttempt.borrowerId, tenantId });

    // Create PayFast fallback CollectionAttempt
    const fallbackAttempt = await CollectionAttempt.create({
      tenantId,
      borrowerId: primaryAttempt.borrowerId,
      loanId: primaryAttempt.loanId,
      activeLoanId: primaryAttempt.activeLoanId || primaryAttempt.loanId,
      repaymentScheduleId: primaryAttempt.repaymentScheduleId,
      installmentIdentifier: primaryAttempt.installmentIdentifier,
      emiNumber: primaryAttempt.emiNumber,
      collectionMethod: 'PAYFAST_CARD',
      provider: 'PAYFAST',
      attemptNumber: 1,
      status: 'SUBMITTED',
      requestedAmount: primaryAttempt.requestedAmount,
      amount: primaryAttempt.requestedAmount,
      originalAttemptId: primaryAttempt._id,
      submittedAt: new Date()
    });

    // Link fallback attempt to primaryAttempt
    primaryAttempt.fallbackStatus = 'TRIGGERED';
    primaryAttempt.fallbackAttemptId = fallbackAttempt._id;
    await primaryAttempt.save();

    console.log(`[PAYFAST_FALLBACK_TRIGGERED] Created PayFast fallback attempt ${fallbackAttempt._id} for failed attempt ${primaryAttempt._id}`);

    // Process PayFast fallback charge
    const fallbackRes = await payFastLoanFallbackProvider.processFallback({
      borrower,
      amount: primaryAttempt.requestedAmount,
      repaymentScheduleId: primaryAttempt.repaymentScheduleId,
      tenantId
    });

    if (fallbackRes.success) {
      fallbackAttempt.status = 'SUCCESSFUL';
      fallbackAttempt.providerReference = fallbackRes.providerReference;
      fallbackAttempt.successfulAt = new Date();
      fallbackAttempt.completedAt = new Date();
      await fallbackAttempt.save();

      console.log(`[PAYFAST_FALLBACK_SUCCESS] Fallback attempt ${fallbackAttempt._id} succeeded.`);

      // Reconcile schedule
      const reconc = await collectionReconciliation.reconcileSuccessfulCollection({
        collectionAttempt: fallbackAttempt,
        tenantId
      });

      console.log(`[COLLECTION_RECONCILED] Reconciled schedule ${schedule._id} via PayFast fallback.`);
      return { triggered: true, fallbackAttempt, reconciliation: reconc };
    } else {
      const statusReason = fallbackRes.reason || 'PayFast fallback failed';
      fallbackAttempt.status = 'FAILED';
      fallbackAttempt.fallbackStatus = ['NOT_CONFIGURED', 'UNAVAILABLE'].includes(fallbackRes.status)
        ? fallbackRes.status
        : 'EXHAUSTED';
      fallbackAttempt.failureReason = statusReason;
      fallbackAttempt.completedAt = new Date();
      await fallbackAttempt.save();

      console.log(`[PAYFAST_FALLBACK_FAILED] Fallback attempt ${fallbackAttempt._id} failed: ${statusReason}`);
      return { triggered: true, fallbackAttempt, reason: statusReason };
    }
  }

  /**
   * Handle isolated PayFast ITN notification for loan collection fallback.
   * NEVER modifies Marketplace orders, Wallets, or SaaS subscriptions.
   */
  async handlePayFastLoanWebhook(body = {}) {
    const tenantId = body.custom_str1;
    const mPaymentId = body.m_payment_id;
    const paymentStatus = body.payment_status;
    const pfPaymentId = body.pf_payment_id;
    const grossAmount = parseFloat(body.amount_gross || body.amount || '0');

    if (!tenantId) {
      throw Object.assign(new Error('Missing tenant context reference in PayFast loan ITN'), { status: 400 });
    }

    const tenantContext = require('../../tenancy/tenantContext');
    return tenantContext.runWithTenant(tenantId, async () => {
      // Find matching fallback collection attempt
      let fallbackAttempt = await CollectionAttempt.findOne({
        tenantId,
        provider: 'PAYFAST',
        $or: [
          { idempotencyKey: mPaymentId },
          { providerReference: pfPaymentId || mPaymentId },
          { _id: body.custom_str4 && body.custom_str4.match(/^[0-9a-fA-F]{24}$/) ? body.custom_str4 : null }
        ].filter(Boolean)
      });

      if (!fallbackAttempt) {
        console.warn(`[PAYFAST_LOAN_WEBHOOK] No matching fallback CollectionAttempt for payment ${mPaymentId}`);
        return { status: 200, message: 'PayFast loan ITN received; attempt record not found' };
      }

      // Idempotency check
      if (fallbackAttempt.status === 'SUCCESSFUL' || fallbackAttempt.status === 'SUCCESS') {
        console.log(`[PAYFAST_LOAN_WEBHOOK_IDEMPOTENT] Fallback attempt ${fallbackAttempt._id} already reconciled`);
        return { status: 200, message: 'PayFast loan collection already processed (idempotent)', isDuplicate: true };
      }

      // Amount validation
      if (fallbackAttempt.requestedAmount > 0 && Math.abs(fallbackAttempt.requestedAmount - grossAmount) > 0.01) {
        console.warn(`[PAYFAST_LOAN_AMOUNT_MISMATCH] Expected R${fallbackAttempt.requestedAmount}, received R${grossAmount}`);
        fallbackAttempt.status = 'FAILED';
        fallbackAttempt.failureReason = `Amount mismatch: expected R${fallbackAttempt.requestedAmount}, received R${grossAmount}`;
        fallbackAttempt.metadata = { ...fallbackAttempt.metadata, amountMismatch: { expected: fallbackAttempt.requestedAmount, received: grossAmount } };
        await fallbackAttempt.save();
        throw Object.assign(new Error(fallbackAttempt.failureReason), { status: 400 });
      }

      if (paymentStatus === 'COMPLETE') {
        fallbackAttempt.status = 'SUCCESSFUL';
        fallbackAttempt.providerReference = pfPaymentId || mPaymentId;
        fallbackAttempt.successfulAt = new Date();
        fallbackAttempt.completedAt = new Date();
        fallbackAttempt.metadata = { ...fallbackAttempt.metadata, itnBody: body };
        await fallbackAttempt.save();

        const reconc = await collectionReconciliation.reconcileSuccessfulCollection({
          collectionAttempt: fallbackAttempt,
          tenantId
        });

        console.log(`[PAYFAST_LOAN_RECONCILED] Successfully reconciled loan fallback via ITN: Attempt ${fallbackAttempt._id}`);
        return { status: 200, message: 'PayFast loan collection reconciled successfully', reconciliation: reconc };
      } else {
        fallbackAttempt.status = 'FAILED';
        fallbackAttempt.fallbackStatus = 'EXHAUSTED';
        fallbackAttempt.failureReason = body.comment || `PayFast payment status: ${paymentStatus}`;
        fallbackAttempt.completedAt = new Date();
        fallbackAttempt.metadata = { ...fallbackAttempt.metadata, itnBody: body };
        await fallbackAttempt.save();

        console.warn(`[PAYFAST_LOAN_FAILED] Fallback attempt ${fallbackAttempt._id} marked FAILED via ITN`);
        return { status: 200, message: `PayFast loan fallback failed with status ${paymentStatus}` };
      }
    });
  }
}

module.exports = new LoanCollectionService();
