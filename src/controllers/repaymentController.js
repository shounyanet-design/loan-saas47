const asyncHandler = require('express-async-handler');
const RepaymentSchedule = require('../models/RepaymentSchedule');
const ActiveLoan = require('../models/ActiveLoan');
const Borrower = require('../models/Borrower');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * @desc    Get repayment schedule for a specific loan
 * @route   GET /api/repayments/loan/:loanId
 * @access  Private
 */
const getLoanRepaymentSchedule = asyncHandler(async (req, res) => {
  const { loanId } = req.params;
  const { role, _id: userId } = req.user;

  const loan = await ActiveLoan.findById(loanId);
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

  let schedule = await RepaymentSchedule.find({ loanId }).sort({ emiNumber: 1 });

  // FALLBACK & AUTO-MIGRATION:
  // If the centralized RepaymentSchedule collection is empty for this loan,
  // we migrate the embedded schedule from the ActiveLoan document.
  if (schedule.length === 0 && loan.repaymentSchedule && loan.repaymentSchedule.length > 0) {
    const migrationData = loan.repaymentSchedule.map(emi => ({
      loanId: loan._id,
      borrowerId: loan.borrowerId,
      emiNumber: emi.installmentNumber,
      dueDate: emi.dueDate,
      amount: emi.emiAmount,
      status: emi.paymentStatus === 'Paid' ? 'Paid' : (emi.paymentStatus === 'Overdue' ? 'Overdue' : 'Pending'),
      paidAt: emi.paidDate || null,
      penaltyAmount: emi.lateFee || 0
    }));
    
    // Bulk insert into new collection
    schedule = await RepaymentSchedule.insertMany(migrationData);
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
        const migrationData = loan.repaymentSchedule.map(emi => ({
          loanId: loan._id,
          borrowerId: loan.borrowerId,
          emiNumber: emi.installmentNumber,
          dueDate: emi.dueDate,
          amount: emi.emiAmount,
          status: emi.paymentStatus === 'Paid' ? 'Paid' : (emi.paymentStatus === 'Overdue' ? 'Overdue' : 'Pending'),
          paidAt: emi.paidDate || null,
          penaltyAmount: emi.lateFee || 0
        }));
        await RepaymentSchedule.insertMany(migrationData);
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

  const repayment = await RepaymentSchedule.findById(req.params.id);
  if (!repayment) {
    return sendError(res, 'Repayment record not found', 404);
  }

  repayment.penaltyAmount = 0;
  repayment.notes = (repayment.notes || '') + `\nPenalty waived by admin on ${new Date().toLocaleDateString()}`;
  await repayment.save();

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
  const repayment = await RepaymentSchedule.findById(req.params.id);
  if (!repayment) {
    return sendError(res, 'Repayment record not found', 404);
  }

  repayment.status = 'Disputed';
  repayment.notes = (repayment.notes || '') + `\nDispute marked by admin: ${reason}`;
  await repayment.save();

  sendSuccess(res, 'Repayment marked as disputed', repayment);
});

module.exports = {
  getLoanRepaymentSchedule,
  getUpcomingEMIs,
  updateRepayment,
  waivePenalty,
  markDispute
};
