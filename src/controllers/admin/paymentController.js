const asyncHandler = require('express-async-handler');
const Payment = require('../../models/Payment');
const ActiveLoan = require('../../models/ActiveLoan');
const RepaymentSchedule = require('../../models/RepaymentSchedule');
const Commission = require('../../models/Commission');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { allocateVerifiedPayment, reverseVerifiedPayment } = require('../../services/paymentAllocationEngine');

/**
 * @desc    Get all payments
 * @route   GET /api/admin/payments
 * @access  Private/Admin
 */
const getAllPayments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = '', status, method, type } = req.query;

  const query = { isDeleted: false };
  if (req.tenantId) query.tenantId = req.tenantId;

  if (search) {
    query.$or = [
      { borrowerName: { $regex: search, $options: 'i' } },
      { loanCode: { $regex: search, $options: 'i' } },
      { transactionId: { $regex: search, $options: 'i' } },
      { borrowerPhone: { $regex: search, $options: 'i' } }
    ];
  }

  if (status) query.paymentStatus = status;
  if (method) query.paymentMethod = method;
  if (type) query.paymentType = type;

  const skip = (page - 1) * limit;

  const payments = await Payment.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await Payment.countDocuments(query);

  sendSuccess(res, 'Payments fetched successfully', {
    payments,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) }
  });
});

/**
 * @desc    Get dashboard stats
 * @route   GET /api/admin/payments/stats
 * @access  Private/Admin
 */
const getPaymentStats = asyncHandler(async (req, res) => {
  const query = { isDeleted: false };
  if (req.tenantId) query.tenantId = req.tenantId;

  const totalPayments = await Payment.countDocuments(query);
  const verifiedPayments = await Payment.countDocuments({ ...query, paymentStatus: 'Verified' });
  const pendingPayments = await Payment.countDocuments({ ...query, paymentStatus: 'Pending' });

  const matchQuery = { isDeleted: false, paymentStatus: 'Verified' };
  if (req.tenantId) {
    const mongoose = require('mongoose');
    matchQuery.tenantId = new mongoose.Types.ObjectId(req.tenantId);
  }

  const aggregate = await Payment.aggregate([
    { $match: matchQuery },
    { $group: { _id: null, totalCollections: { $sum: '$paymentAmount' } } }
  ]);
  const totalCollections = aggregate.length > 0 ? aggregate[0].totalCollections : 0;

  sendSuccess(res, 'Payment stats fetched successfully', {
    totalPayments,
    verifiedPayments,
    pendingPayments,
    totalCollections
  });
});

/**
 * @desc    Get single payment
 * @route   GET /api/admin/payments/:id
 * @access  Private/Admin
 */
const getPaymentDetails = asyncHandler(async (req, res) => {
  const query = { _id: req.params.id, isDeleted: false };
  if (req.tenantId) query.tenantId = req.tenantId;
  const payment = await Payment.findOne(query);
  if (!payment) return sendError(res, 'Payment not found', 404);
  sendSuccess(res, 'Payment details fetched successfully', { payment });
});

/**
 * @desc    Verify payment
 * @route   PUT /api/admin/payments/:id/verify
 * @access  Private/Admin
 */
const verifyPayment = asyncHandler(async (req, res) => {
  const query = { _id: req.params.id, isDeleted: false };
  if (req.tenantId) query.tenantId = req.tenantId;
  const payment = await Payment.findOne(query);
  if (!payment) return sendError(res, 'Payment not found', 404);

  if (payment.paymentStatus === 'Verified') {
    return sendError(res, 'Payment is already verified', 400);
  }

  // Update payment status first
  payment.paymentStatus = 'Verified';
  payment.verifiedBy = req.user._id;
  payment.verifiedDate = new Date();
  await payment.save();

  try {
    const { activeLoan } = await allocateVerifiedPayment(payment._id, req.user._id);

    // Update Agent Earnings (Commissions)
    const borrower = await require('../../models/Borrower').findById(activeLoan.borrowerId);
    if (borrower && borrower.assignedAgent) {
      const commission = await Commission.findOne({ 
        loanId: activeLoan._id, 
        agentId: borrower.assignedAgent,
        status: 'Pending'
      });
      if (commission) {
        commission.status = 'Paid';
        commission.paidAt = new Date();
        await commission.save();
      }
    }

    sendSuccess(res, 'Payment verified and allocated successfully', { payment, activeLoan });
  } catch (allocErr) {
    payment.paymentStatus = 'Pending';
    payment.verifiedBy = null;
    payment.verifiedDate = null;
    await payment.save();
    return sendError(res, allocErr.message || 'Payment allocation failed', 500);
  }
});

/**
 * @desc    Reverse payment
 * @route   PUT /api/admin/payments/:id/reverse
 * @access  Private/Admin
 */
const reversePayment = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) {
    return sendError(res, 'Reversal reason is required', 400);
  }

  const query = { _id: req.params.id, isDeleted: false };
  if (req.tenantId) query.tenantId = req.tenantId;
  const payment = await Payment.findOne(query);
  if (!payment) return sendError(res, 'Payment not found', 404);

  if (payment.paymentStatus !== 'Verified') {
    return sendError(res, 'Only verified payments can be reversed', 400);
  }

  try {
    const { activeLoan, payment: reversedPayment } = await reverseVerifiedPayment(payment._id, req.user._id, reason);
    sendSuccess(res, 'Payment reversed successfully', { activeLoan, payment: reversedPayment });
  } catch (err) {
    return sendError(res, err.message || 'Payment reversal failed', 500);
  }
});
/**
 * @desc    Reject payment
 * @route   PUT /api/admin/payments/:id/reject
 * @access  Private/Admin
 */
const rejectPayment = asyncHandler(async (req, res) => {
  const { rejectionReason, notes } = req.body;
  
  const payment = await Payment.findOne({ _id: req.params.id, isDeleted: false });
  if (!payment) return sendError(res, 'Payment not found', 404);

  if (payment.paymentStatus === 'Verified') {
    return sendError(res, 'Cannot reject an already verified payment', 400);
  }

  payment.paymentStatus = 'Rejected';
  payment.rejectionReason = rejectionReason;
  payment.notes = notes;
  
  await payment.save();

  sendSuccess(res, 'Payment rejected successfully', { payment });
});

/**
 * @desc    Get specific statuses
 * @route   GET /api/admin/payments/pending (or verified/rejected)
 * @access  Private/Admin
 */
const getPendingPayments = asyncHandler(async (req, res) => {
  const payments = await Payment.find({ paymentStatus: 'Pending', isDeleted: false }).sort({ createdAt: -1 });
  sendSuccess(res, 'Pending payments fetched successfully', { payments });
});

const getVerifiedPayments = asyncHandler(async (req, res) => {
  const payments = await Payment.find({ paymentStatus: 'Verified', isDeleted: false }).sort({ createdAt: -1 });
  sendSuccess(res, 'Verified payments fetched successfully', { payments });
});

const getRejectedPayments = asyncHandler(async (req, res) => {
  const payments = await Payment.find({ paymentStatus: 'Rejected', isDeleted: false }).sort({ createdAt: -1 });
  sendSuccess(res, 'Rejected payments fetched successfully', { payments });
});

/**
 * @desc    Get export data
 * @route   GET /api/admin/payments/export
 * @access  Private/Admin
 */
const exportPayments = asyncHandler(async (req, res) => {
  const payments = await Payment.find({ isDeleted: false }).lean();
  sendSuccess(res, 'Export data ready', { payments });
});

/**
 * @desc    Download receipt details (For frontend to open link or get receiptImage)
 * @route   GET /api/admin/payments/:id/receipt
 * @access  Private/Admin
 */
const downloadReceipt = asyncHandler(async (req, res) => {
  const payment = await Payment.findOne({ _id: req.params.id, isDeleted: false });
  if (!payment || (!payment.receiptImage && !payment.receiptFile)) {
    return sendError(res, 'Receipt not found', 404);
  }
  
  sendSuccess(res, 'Receipt fetched successfully', { receiptUrl: payment.receiptFile || payment.receiptImage });
});

module.exports = {
  getAllPayments,
  getPaymentStats,
  getPaymentDetails,
  verifyPayment,
  rejectPayment,
  getPendingPayments,
  getVerifiedPayments,
  getRejectedPayments,
  exportPayments,
  downloadReceipt,
  reversePayment
};
