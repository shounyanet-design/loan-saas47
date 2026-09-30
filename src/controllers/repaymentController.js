const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const RepaymentSchedule = require('../models/RepaymentSchedule');
const ActiveLoan = require('../models/ActiveLoan');
const Borrower = require('../models/Borrower');
const Payment = require('../models/Payment');
const DuePayment = require('../models/DuePayment');
const LoanActivity = require('../models/LoanActivity');
const tenantContext = require('../tenancy/tenantContext');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * @desc    Get repayment schedule for a specific loan
 * @route   GET /api/repayments/loan/:loanId
 * @access  Private
 */
const getLoanRepaymentSchedule = asyncHandler(async (req, res) => {
  const { loanId } = req.params;
  const { role, _id: userId } = req.user;

  const query = { _id: loanId };
  if (req.tenantId) query.tenantId = req.tenantId;

  const loan = await ActiveLoan.findOne(query);
  if (!loan) {
    return sendError(res, 'Loan not found', 404);
  }

  // Role-based access control
  if (role === 'borrower' && loan.borrowerId.toString() !== userId.toString()) {
    return sendError(res, 'Access denied', 403);
  }

  if (role === 'agent' && loan.assignedAgent?.toString() !== userId.toString()) {
    return sendError(res, 'Access denied', 403);
  }

  // Staff and Admin have full access to view
  const schedQuery = { loanId };
  if (req.tenantId) schedQuery.tenantId = req.tenantId;

  let schedule = await RepaymentSchedule.find(schedQuery).sort({ emiNumber: 1 });

  // FALLBACK & AUTO-MIGRATION:
  // If the centralized RepaymentSchedule collection is empty for this tenant query,
  // check if legacy records exist without tenantId, or migrate the embedded schedule.
  if (schedule.length === 0) {
    const targetTenantId = loan.tenantId || req.tenantId;

    // Check if schedules already exist un-scoped in the database (e.g. missing tenantId)
    const existingRaw = await tenantContext.runAsSystem(() =>
      RepaymentSchedule.find({ loanId }).sort({ emiNumber: 1 })
    );

    if (existingRaw.length > 0) {
      if (targetTenantId) {
        await tenantContext.runAsSystem(() =>
          RepaymentSchedule.updateMany(
            { loanId, tenantId: { $in: [null, undefined] } },
            { $set: { tenantId: targetTenantId } }
          )
        );
      }
      schedule = await RepaymentSchedule.find(schedQuery).sort({ emiNumber: 1 });
    } else if (loan.repaymentSchedule && loan.repaymentSchedule.length > 0) {
      const migrationData = loan.repaymentSchedule.map(emi => ({
        tenantId: targetTenantId,
        loanId: loan._id,
        borrowerId: loan.borrowerId,
        emiNumber: emi.installmentNumber,
        dueDate: emi.dueDate,
        amount: emi.emiAmount,
        status: emi.paymentStatus === 'Paid' ? 'Paid' : (emi.paymentStatus === 'Overdue' ? 'Overdue' : 'Pending'),
        paidAt: emi.paidDate || null,
        penaltyAmount: emi.lateFee || 0
      }));

      try {
        schedule = await RepaymentSchedule.insertMany(migrationData, { ordered: false });
      } catch (insertErr) {
        if (insertErr.code === 11000 || insertErr.name === 'MongoBulkWriteError') {
          if (targetTenantId) {
            await tenantContext.runAsSystem(() =>
              RepaymentSchedule.updateMany(
                { loanId, tenantId: { $in: [null, undefined] } },
                { $set: { tenantId: targetTenantId } }
              )
            );
          }
          schedule = await RepaymentSchedule.find(schedQuery).sort({ emiNumber: 1 });
        } else {
          throw insertErr;
        }
      }
    }

    // Graceful fallback to avoid 400/500 if DB insert failed or collection empty
    if (!schedule || schedule.length === 0) {
      schedule = (loan.repaymentSchedule || []).map(emi => ({
        _id: emi._id,
        loanId: loan._id,
        borrowerId: loan.borrowerId,
        emiNumber: emi.installmentNumber,
        dueDate: emi.dueDate,
        amount: emi.emiAmount,
        status: emi.paymentStatus === 'Paid' ? 'Paid' : (emi.paymentStatus === 'Overdue' ? 'Overdue' : 'Pending'),
        paidAt: emi.paidDate || null,
        penaltyAmount: emi.lateFee || 0
      }));
    }
  }

  sendSuccess(res, 'Repayment schedule fetched successfully', schedule);
});

/**
 * @desc    Get upcoming EMIs for the logged-in user
 * @route   GET /api/repayments/upcoming
 * @access  Private
 */
const getUpcomingEMIs = asyncHandler(async (req, res) => {
  const { role, _id: userId } = req.user;
  let query = { status: 'Pending' };

  if (role === 'borrower') {
    const borrower = await Borrower.findOne({ userId });
    if (!borrower) return sendError(res, 'Borrower profile not found', 404);
    query.borrowerId = borrower._id;
    
    // Check if we need to migrate any loans for this borrower
    const activeLoans = await ActiveLoan.find({ borrowerId: borrower._id, isDeleted: false });
    for (const loan of activeLoans) {
      const scheduleCount = await RepaymentSchedule.countDocuments({ loanId: loan._id });
      if (scheduleCount === 0 && loan.repaymentSchedule && loan.repaymentSchedule.length > 0) {
        const targetTenantId = loan.tenantId || req.tenantId;
        const migrationData = loan.repaymentSchedule.map(emi => ({
          tenantId: targetTenantId,
          loanId: loan._id,
          borrowerId: loan.borrowerId,
          emiNumber: emi.installmentNumber,
          dueDate: emi.dueDate,
          amount: emi.emiAmount,
          status: emi.paymentStatus === 'Paid' ? 'Paid' : (emi.paymentStatus === 'Overdue' ? 'Overdue' : 'Pending'),
          paidAt: emi.paidDate || null,
          penaltyAmount: emi.lateFee || 0
        }));
        try {
          await RepaymentSchedule.insertMany(migrationData, { ordered: false });
        } catch (insertErr) {
          if (insertErr.code === 11000 || insertErr.name === 'MongoBulkWriteError') {
            if (targetTenantId) {
              await tenantContext.runAsSystem(() =>
                RepaymentSchedule.updateMany(
                  { loanId: loan._id, tenantId: { $in: [null, undefined] } },
                  { $set: { tenantId: targetTenantId } }
                )
              );
            }
          } else {
            console.warn('[repaymentController] getUpcomingEMIs insertMany warning:', insertErr.message);
          }
        }
      }
    }
  } else if (role === 'agent') {
    // Find loans assigned to this agent
    const agentLoans = await ActiveLoan.find({ assignedAgent: userId }).select('_id');
    const loanIds = agentLoans.map(l => l._id);
    query.loanId = { $in: loanIds };
  }

  const upcoming = await RepaymentSchedule.find({
    ...query,
    dueDate: { $gte: new Date() }
  }).populate('loanId').sort({ dueDate: 1 }).limit(10);

  sendSuccess(res, 'Upcoming EMIs fetched successfully', upcoming);
});

/**
 * @desc    Update repayment (Admin only)
 * @route   PUT /api/repayments/:id
 * @access  Private/Admin
 */
const updateRepayment = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return sendError(res, 'Access denied', 403);
  }

  const { status, penaltyAmount, amount } = req.body;
  const repayment = await RepaymentSchedule.findById(req.params.id);

  if (!repayment) {
    return sendError(res, 'Repayment record not found', 404);
  }

  if (status) repayment.status = status;
  if (penaltyAmount !== undefined) repayment.penaltyAmount = penaltyAmount;
  if (amount !== undefined) repayment.amount = amount;

  await repayment.save();

  sendSuccess(res, 'Repayment record updated successfully', repayment);
});

/**
 * @desc    Waive penalty for a repayment
 * @route   POST /api/repayments/:id/waive-penalty
 * @access  Private/Admin
 */
const waivePenalty = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return sendError(res, 'Access denied', 403);
  }

  const query = { _id: req.params.id };
  if (req.tenantId) query.tenantId = req.tenantId;

  const repayment = await RepaymentSchedule.findOne(query);
  if (!repayment) {
    return sendError(res, 'Repayment record not found', 404);
  }

  repayment.penaltyWaived = true;
  repayment.penaltyWaivedAt = new Date();
  repayment.penaltyWaivedBy = req.user._id;
  repayment.penaltyAmount = 0;
  repayment.notes = (repayment.notes || '') + `\nPenalty waived by admin on ${new Date().toLocaleDateString()}`;
  await repayment.save();

  // Sync with activeLoan embedded list
  const activeLoan = await ActiveLoan.findById(repayment.loanId);
  if (activeLoan && Array.isArray(activeLoan.repaymentSchedule)) {
    const emi = activeLoan.repaymentSchedule.find(s => s.installmentNumber === repayment.emiNumber);
    if (emi) {
      emi.lateFee = 0;
      emi.penaltyWaived = true;
      await activeLoan.save();
    }
  }

  // Update corresponding DuePayment if it exists
  const DuePayment = require('../models/DuePayment');
  await DuePayment.findOneAndUpdate(
    { loanId: repayment.loanId, installmentNumber: repayment.emiNumber },
    { penaltyAmount: 0, totalDueAmount: repayment.amount }
  );

  sendSuccess(res, 'Penalty waived successfully', repayment);
});

/**
 * @desc    Mark repayment as disputed
 * @route   POST /api/repayments/:id/dispute
 * @access  Private/Admin
 */
const markDispute = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return sendError(res, 'Access denied', 403);
  }

  const { reason } = req.body;
  const query = { _id: req.params.id };
  if (req.tenantId) query.tenantId = req.tenantId;

  const repayment = await RepaymentSchedule.findOne(query);
  if (!repayment) {
    return sendError(res, 'Repayment record not found', 404);
  }

  repayment.status = 'Disputed';
  repayment.notes = (repayment.notes || '') + `\nDispute marked by admin: ${reason}`;
  await repayment.save();

  sendSuccess(res, 'Dispute marked successfully', repayment);
});

/**
 * @desc    Receive manual payment for a specific EMI installment
 * @route   POST /api/repayments/:id/receive-payment
 * @access  Private/Admin
 */
const receiveManualEmiPayment = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return sendError(res, 'Access denied', 403);
  }

  const { id: scheduleId } = req.params;
  const { paymentAmount, paymentDate, paymentMethod = 'Bank Transfer', transactionId, notes } = req.body;

  // 1. Resolve RepaymentSchedule
  const schedQuery = { _id: scheduleId };
  if (req.tenantId) schedQuery.tenantId = req.tenantId;

  const schedule = await RepaymentSchedule.findOne(schedQuery);
  if (!schedule) {
    return sendError(res, 'Repayment schedule record not found', 404);
  }

  // 2. Resolve ActiveLoan
  const loanQuery = { _id: schedule.loanId };
  if (req.tenantId) loanQuery.tenantId = req.tenantId;

  const activeLoan = await ActiveLoan.findOne(loanQuery);
  if (!activeLoan) {
    return sendError(res, 'Associated active loan not found', 404);
  }

  if (activeLoan.isDeleted || activeLoan.loanStatus === 'Closed') {
    return sendError(res, 'Cannot record payment for a closed or deleted loan', 400);
  }

  // 3. Status Guard
  if (schedule.status === 'Paid') {
    return sendError(res, `Installment #${schedule.emiNumber} is already fully paid`, 400);
  }

  // 4. Validate Amount
  const numAmount = Number(paymentAmount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return sendError(res, 'Payment amount must be greater than zero', 400);
  }

  const effectivePenalty = schedule.penaltyWaived ? 0 : (schedule.penaltyAmount || 0);
  const totalEmiDue = Number(schedule.amount) + Number(effectivePenalty);
  const currentAmountPaid = Number(schedule.amountPaid) || 0;
  const remainingEmiDue = Math.max(0, totalEmiDue - currentAmountPaid);

  // Precision rounding to 2 decimals
  const roundedRemaining = Math.round(remainingEmiDue * 100) / 100;
  const roundedPayment = Math.round(numAmount * 100) / 100;

  if (roundedPayment > (roundedRemaining + 0.01)) {
    return sendError(
      res,
      `Payment amount (R ${roundedPayment.toFixed(2)}) exceeds remaining due (R ${roundedRemaining.toFixed(2)}) for Installment #${schedule.emiNumber}`,
      400
    );
  }

  // 5. Validate Payment Method
  const allowedMethods = ['Bank Transfer', 'EFT', 'Cash Deposit', 'Mobile Payment', 'Debit Order'];
  const sanitizedMethod = allowedMethods.includes(paymentMethod) ? paymentMethod : 'Bank Transfer';

  // 6. Check unique transactionId if provided
  const targetTenantId = activeLoan.tenantId || req.tenantId;
  if (transactionId && String(transactionId).trim()) {
    const existingPayment = await Payment.findOne({
      tenantId: targetTenantId,
      transactionId: String(transactionId).trim(),
      isDeleted: false
    });
    if (existingPayment) {
      return sendError(res, `Transaction reference "${String(transactionId).trim()}" already exists`, 400);
    }
  }

  // 7. Session Transaction Execution
  let session = null;
  let useTransaction = false;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    useTransaction = true;
  } catch (_) {
    session = null;
    useTransaction = false;
  }

  const opts = useTransaction && session ? { session } : {};

  try {
    // a) Update RepaymentSchedule
    schedule.amountPaid = Math.round((currentAmountPaid + roundedPayment) * 100) / 100;
    if (schedule.amountPaid >= (totalEmiDue - 0.01)) {
      schedule.status = 'Paid';
      schedule.paidAt = paymentDate ? new Date(paymentDate) : new Date();
    } else {
      schedule.status = 'Partial';
    }
    await schedule.save(opts);

    // b) Create Verified Payment record
    const paymentDoc = {
      tenantId: targetTenantId,
      borrowerId: activeLoan.borrowerId,
      borrowerName: activeLoan.borrowerName || 'Borrower',
      borrowerPhone: activeLoan.borrowerPhone,
      loanId: activeLoan._id,
      loanCode: activeLoan.loanCode,
      repaymentScheduleId: schedule._id,
      emiNumber: schedule.emiNumber,
      paymentAmount: roundedPayment,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentMethod: sanitizedMethod,
      paymentStatus: 'Verified',
      paymentType: 'EMI Payment',
      verifiedBy: req.user._id,
      verifiedDate: new Date(),
      notes: notes || `Manual payment received for EMI #${schedule.emiNumber}`
    };

    if (transactionId && String(transactionId).trim()) {
      paymentDoc.transactionId = String(transactionId).trim();
    }

    const [createdPayment] = await Payment.create([paymentDoc], opts);

    // c) Synchronize embedded activeLoan.repaymentSchedule
    if (Array.isArray(activeLoan.repaymentSchedule)) {
      const embeddedEmi = activeLoan.repaymentSchedule.find(s => s.installmentNumber === schedule.emiNumber);
      if (embeddedEmi) {
        embeddedEmi.amountPaid = schedule.amountPaid;
        embeddedEmi.paymentStatus = schedule.status === 'Paid' ? 'Paid' : 'Partial';
        embeddedEmi.paidDate = schedule.paidAt;
      }
    }

    // d) Recalculate remaining balance from authoritative verified payments
    const verifiedPayments = await Payment.find({
      loanId: activeLoan._id,
      paymentStatus: 'Verified',
      isDeleted: false
    }).session(session);

    const totalVerifiedPaid = verifiedPayments.reduce((sum, p) => sum + (Number(p.paymentAmount) || 0), 0);
    const totalPayable = Number(activeLoan.totalPayableAmount) || Number(activeLoan.approvedAmount) || 0;
    activeLoan.remainingBalance = Math.max(0, Math.round((totalPayable - totalVerifiedPaid) * 100) / 100);

    // e) Stash remaining balance onto payment document
    createdPayment.remainingBalanceAfterPayment = activeLoan.remainingBalance;
    await createdPayment.save(opts);

    // f) Update nextDueDate & loan status
    const allSchedules = await RepaymentSchedule.find({ loanId: activeLoan._id }).sort({ emiNumber: 1 }).session(session);
    const nextUnpaid = allSchedules.find(s => s.status !== 'Paid' && s.status !== 'Late Paid');
    activeLoan.nextDueDate = nextUnpaid ? nextUnpaid.dueDate : null;

    const allPaid = allSchedules.every(s => s.status === 'Paid' || s.status === 'Late Paid');
    if (activeLoan.remainingBalance === 0 && allPaid) {
      activeLoan.loanStatus = 'Completed';
      activeLoan.settledAt = new Date();
      activeLoan.settledBy = req.user._id;
    }

    await activeLoan.save(opts);

    // g) Synchronize DuePayment if installment became Paid
    if (schedule.status === 'Paid') {
      await DuePayment.findOneAndUpdate(
        { loanId: activeLoan._id, installmentNumber: schedule.emiNumber },
        { dueStatus: 'Paid', totalDueAmount: 0 },
        opts
      );
    }

    // h) Audit logging via LoanActivity
    await LoanActivity.create([{
      tenantId: targetTenantId,
      loanId: activeLoan._id,
      borrowerId: activeLoan.borrowerId,
      title: 'Manual Payment Received',
      message: `Manual payment of R ${roundedPayment.toFixed(2)} received for EMI #${schedule.emiNumber} via ${sanitizedMethod} (Ref: ${createdPayment.transactionId}).`,
      type: 'Payment'
    }], opts);

    if (useTransaction && session) {
      await session.commitTransaction();
      session.endSession();
    }

    // i) Emit real-time updates
    try {
      const { getIO } = require('../socket');
      const io = getIO();
      if (io) {
        io.emit('payment:verified', { paymentId: createdPayment._id, loanId: activeLoan._id });
        io.emit('dashboard:updated', { trigger: 'manual_emi_payment' });
      }
    } catch (_) {}

    return sendSuccess(res, 'Payment recorded and verified successfully', {
      payment: createdPayment,
      schedule,
      activeLoan
    });
  } catch (err) {
    if (useTransaction && session) {
      await session.abortTransaction();
      session.endSession();
    }
    throw err;
  }
});

module.exports = {
  getLoanRepaymentSchedule,
  getUpcomingEMIs,
  updateRepayment,
  waivePenalty,
  markDispute,
  receiveManualEmiPayment
};
