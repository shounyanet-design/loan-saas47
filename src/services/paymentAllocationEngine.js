const Payment = require('../models/Payment');
const ActiveLoan = require('../models/ActiveLoan');
const RepaymentSchedule = require('../models/RepaymentSchedule');
const PlatformAuditLog = require('../modules/platform/models/PlatformAuditLog');

/**
 * Allocate a verified payment to active loan repayment schedule items sequentially
 */
const allocateVerifiedPayment = async (paymentId, adminUserId, session = null) => {
  const options = session ? { session } : {};
  const payment = await Payment.findById(paymentId).session(session);
  if (!payment) throw new Error('Payment not found');

  if (payment.paymentStatus !== 'Verified') {
    throw new Error('Payment must be verified to allocate');
  }

  const activeLoan = await ActiveLoan.findById(payment.loanId).session(session);
  if (!activeLoan) throw new Error('Associated active loan not found');

  // Fetch all schedules for this loan
  const schedules = await RepaymentSchedule.find({ loanId: activeLoan._id }).sort({ emiNumber: 1 }).session(session);

  let remainingAmount = payment.paymentAmount;

  for (const sched of schedules) {
    if (remainingAmount <= 0) break;

    const effectivePenalty = sched.penaltyWaived ? 0 : (sched.penaltyAmount || 0);
    const totalDue = sched.amount + effectivePenalty;
    const unpaid = Math.max(0, totalDue - sched.amountPaid);

    if (unpaid > 0) {
      if (remainingAmount >= unpaid) {
        sched.amountPaid += unpaid;
        sched.status = 'Paid';
        sched.paidAt = payment.paymentDate || new Date();
        remainingAmount -= unpaid;
      } else {
        sched.amountPaid += remainingAmount;
        sched.status = 'Partial';
        remainingAmount = 0;
      }
      await sched.save(options);
    }
  }

  // Update embedded array in ActiveLoan document
  if (Array.isArray(activeLoan.repaymentSchedule)) {
    activeLoan.repaymentSchedule.forEach(emi => {
      const correspondingSched = schedules.find(s => s.emiNumber === emi.installmentNumber);
      if (correspondingSched) {
        emi.paymentStatus = correspondingSched.status === 'Paid' ? 'Paid' : (correspondingSched.status === 'Partial' ? 'Partial' : emi.paymentStatus);
        emi.amountPaid = correspondingSched.amountPaid;
        emi.lateFee = correspondingSched.penaltyAmount;
        emi.penaltyWaived = correspondingSched.penaltyWaived;
        emi.paidDate = correspondingSched.paidAt;
      }
    });
  }

  // Recalculate remaining balance from DB records: totalPayableAmount - totalVerifiedPaid
  const verifiedPayments = await Payment.find({
    loanId: activeLoan._id,
    paymentStatus: 'Verified',
    isDeleted: false
  }).session(session);
  const totalPaid = verifiedPayments.reduce((sum, p) => sum + (Number(p.paymentAmount) || 0), 0);

  const totalPayable = Number(activeLoan.totalPayableAmount) || Number(activeLoan.approvedAmount) || 0;
  activeLoan.remainingBalance = Math.max(0, totalPayable - totalPaid);

  // Update nextDueDate
  const nextUnpaid = schedules.find(s => s.status !== 'Paid' && s.status !== 'Late Paid');
  activeLoan.nextDueDate = nextUnpaid ? nextUnpaid.dueDate : null;

  // Auto-close loan if remaining balance is zero and all schedules are paid
  if (activeLoan.remainingBalance === 0) {
    activeLoan.loanStatus = 'Completed';
    activeLoan.settledAt = new Date();
    activeLoan.settledBy = adminUserId;
  }

  await activeLoan.save(options);

  return { activeLoan, schedules };
};

/**
 * Reverse a verified payment, restore balances and re-open loan/schedule
 */
const reverseVerifiedPayment = async (paymentId, adminUserId, reason, session = null) => {
  const options = session ? { session } : {};
  const payment = await Payment.findById(paymentId).session(session);
  if (!payment) throw new Error('Payment not found');

  if (payment.paymentStatus !== 'Verified') {
    throw new Error('Only verified payments can be reversed');
  }

  payment.paymentStatus = 'Reversed';
  payment.notes = (payment.notes ? payment.notes + '\n' : '') + `Reversed by Admin: ${reason}`;
  await payment.save(options);

  const activeLoan = await ActiveLoan.findById(payment.loanId).session(session);
  if (!activeLoan) throw new Error('Associated active loan not found');

  const schedules = await RepaymentSchedule.find({ loanId: activeLoan._id }).sort({ emiNumber: 1 }).session(session);
  
  for (const s of schedules) {
    s.amountPaid = 0;
    s.status = 'Pending';
    s.paidAt = null;
  }

  const remainingVerifiedPayments = await Payment.find({
    loanId: activeLoan._id,
    paymentStatus: 'Verified',
    isDeleted: false
  }).sort({ paymentDate: 1 }).session(session);

  for (const p of remainingVerifiedPayments) {
    let rem = p.paymentAmount;
    for (const sched of schedules) {
      if (rem <= 0) break;
      const effectivePenalty = sched.penaltyWaived ? 0 : (sched.penaltyAmount || 0);
      const totalDue = sched.amount + effectivePenalty;
      const unpaid = Math.max(0, totalDue - sched.amountPaid);
      if (unpaid > 0) {
        if (rem >= unpaid) {
          sched.amountPaid += unpaid;
          sched.status = 'Paid';
          sched.paidAt = p.paymentDate;
          rem -= unpaid;
        } else {
          sched.amountPaid += rem;
          sched.status = 'Partial';
          rem = 0;
        }
      }
    }
  }

  for (const sched of schedules) {
    await sched.save(options);
  }

  if (Array.isArray(activeLoan.repaymentSchedule)) {
    activeLoan.repaymentSchedule.forEach(emi => {
      const correspondingSched = schedules.find(s => s.emiNumber === emi.installmentNumber);
      if (correspondingSched) {
        emi.paymentStatus = correspondingSched.status === 'Paid' ? 'Paid' : (correspondingSched.status === 'Partial' ? 'Partial' : 'Pending');
        emi.amountPaid = correspondingSched.amountPaid;
        emi.paidDate = correspondingSched.paidAt;
      }
    });
  }

  const totalPaid = remainingVerifiedPayments.reduce((sum, p) => sum + (Number(p.paymentAmount) || 0), 0);
  const totalPayable = Number(activeLoan.totalPayableAmount) || Number(activeLoan.approvedAmount) || 0;
  activeLoan.remainingBalance = Math.max(0, totalPayable - totalPaid);

  const nextUnpaid = schedules.find(s => s.status !== 'Paid' && s.status !== 'Late Paid');
  activeLoan.nextDueDate = nextUnpaid ? nextUnpaid.dueDate : null;

  if (activeLoan.remainingBalance > 0 && activeLoan.loanStatus === 'Completed') {
    activeLoan.loanStatus = 'Active';
    activeLoan.settledAt = null;
    activeLoan.settledBy = null;
  }

  await activeLoan.save(options);

  await PlatformAuditLog.create([{
    tenantId: activeLoan.tenantId,
    userId: adminUserId,
    action: 'PAYMENT_REVERSED',
    entity: 'Payment',
    entityId: payment._id,
    description: `Payment ${payment.transactionId} of R ${payment.paymentAmount} reversed for loan ${activeLoan.loanCode}. Reason: ${reason}`,
    createdAt: new Date()
  }], options);

  return { activeLoan, payment };
};

module.exports = {
  allocateVerifiedPayment,
  reverseVerifiedPayment
};
