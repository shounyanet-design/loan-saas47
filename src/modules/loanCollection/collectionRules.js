const RepaymentSchedule = require('../../models/RepaymentSchedule');
const Borrower = require('../../models/Borrower');
const ActiveLoan = require('../../models/ActiveLoan');
const CollectionAttempt = require('../../models/CollectionAttempt');

class CollectionRules {
  /**
   * Validate that a repayment schedule is eligible for primary DebiCheck collection.
   */
  async validatePrimaryEligibility(repaymentScheduleId, tenantId) {
    const schedule = await RepaymentSchedule.findOne({ _id: repaymentScheduleId, tenantId });
    if (!schedule) {
      throw new Error(`RepaymentSchedule ${repaymentScheduleId} not found for tenant ${tenantId}`);
    }

    if (schedule.status === 'Paid') {
      return { eligible: false, reason: 'INSTALLMENT_ALREADY_PAID', schedule };
    }

    // Check if an active/successful collection attempt already exists
    const activeAttempt = await CollectionAttempt.findOne({
      tenantId,
      repaymentScheduleId,
      status: { $in: ['PENDING', 'SUBMITTED', 'PROCESSING', 'TRACKING', 'SUCCESSFUL', 'SUCCESS'] }
    });

    if (activeAttempt) {
      return { eligible: false, reason: 'ACTIVE_COLLECTION_EXISTS', schedule, activeAttempt };
    }

    const borrower = await Borrower.findOne({ _id: schedule.borrowerId, tenantId });
    if (!borrower) {
      throw new Error(`Borrower ${schedule.borrowerId} not found`);
    }

    if (borrower.isBlacklisted || borrower.isFrozen) {
      return { eligible: false, reason: 'BORROWER_ACCOUNT_RESTRICTED', schedule, borrower };
    }

    const loan = await ActiveLoan.findOne({ _id: schedule.loanId, tenantId });
    if (!loan) {
      throw new Error(`ActiveLoan ${schedule.loanId} not found`);
    }

    // Must have active RealPay / DebiCheck mandate reference
    const mandateRef = borrower.collectionProfile?.debicheckMandateReference || loan.debicheckMandateReference;
    if (!mandateRef) {
      return { eligible: false, reason: 'MISSING_REALPAY_MANDATE', schedule, borrower, loan };
    }

    return {
      eligible: true,
      schedule,
      borrower,
      loan,
      mandateRef,
      amount: schedule.amount
    };
  }

  /**
   * Validate whether a borrower has valid PayFast fallback credentials/token.
   */
  validatePayFastFallbackEligibility(borrower) {
    const profile = borrower?.collectionProfile || {};
    const tokenRef = profile.payfastTokenReference;

    if (!tokenRef) {
      return {
        configured: false,
        reason: 'NO_PAYFAST_TOKEN',
        status: 'NOT_CONFIGURED'
      };
    }

    if (['FAILED', 'CANCELLED', 'EXPIRED', 'PENDING'].includes(profile.tokenStatus)) {
      return {
        configured: false,
        reason: `PAYFAST_TOKEN_${profile.tokenStatus}`,
        status: 'UNAVAILABLE'
      };
    }

    return {
      configured: true,
      tokenRef,
      status: 'ELIGIBLE'
    };
  }
}

module.exports = new CollectionRules();
