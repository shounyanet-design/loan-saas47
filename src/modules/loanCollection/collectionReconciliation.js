const RepaymentSchedule = require('../../models/RepaymentSchedule');
const Payment = require('../../models/Payment');
const ActiveLoan = require('../../models/ActiveLoan');
const Borrower = require('../../models/Borrower');

class CollectionReconciliation {
  /**
   * Reconcile a successful collection attempt into RepaymentSchedule & Payment.
   * Idempotent: safe against duplicate calls/webhooks.
   */
  async reconcileSuccessfulCollection({ collectionAttempt, tenantId }) {
    if (!collectionAttempt || !tenantId) {
      throw new Error('collectionAttempt and tenantId are required for reconciliation');
    }

    const schedule = await RepaymentSchedule.findOne({
      _id: collectionAttempt.repaymentScheduleId,
      tenantId
    });

    if (!schedule) {
      throw new Error(`RepaymentSchedule ${collectionAttempt.repaymentScheduleId} not found`);
    }

    // 1. Update RepaymentSchedule if not already paid
    if (schedule.status !== 'Paid') {
      schedule.status = 'Paid';
      schedule.paidAt = collectionAttempt.successfulAt || new Date();
      schedule.amountPaid = collectionAttempt.requestedAmount || schedule.amount;
      await schedule.save();
    }

    const loan = await ActiveLoan.findOne({ _id: collectionAttempt.loanId, tenantId });
    const borrower = await Borrower.findOne({ _id: collectionAttempt.borrowerId, tenantId });

    // 2. Idempotent Payment Record Creation
    const transactionId = `TX-COLL-${collectionAttempt._id}`;
    let payment = await Payment.findOne({ tenantId, transactionId });

    if (!payment) {
      payment = await Payment.create({
        tenantId,
        borrowerId: collectionAttempt.borrowerId,
        borrowerName: borrower ? borrower.fullName : 'Borrower',
        borrowerPhone: borrower ? borrower.phoneNumber : '',
        loanId: collectionAttempt.loanId,
        loanCode: loan ? loan.loanCode : `LN-${collectionAttempt.loanId}`,
        transactionId,
        paymentAmount: collectionAttempt.requestedAmount || schedule.amount,
        paymentDate: collectionAttempt.successfulAt || new Date(),
        paymentMethod: 'Debit Order',
        paymentStatus: 'Verified',
        paymentType: 'EMI Payment',
        notes: `Automated collection reconciled via ${collectionAttempt.provider} (${collectionAttempt.collectionMethod}). Provider Ref: ${collectionAttempt.providerReference || 'N/A'}`
      });
    }

    return {
      reconciled: true,
      schedule,
      payment
    };
  }
}

module.exports = new CollectionReconciliation();
