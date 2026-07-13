const ActiveLoan = require('../../models/ActiveLoan');
const RepaymentSchedule = require('../../models/RepaymentSchedule');
const Payment = require('../../models/Payment');
const Borrower = require('../../models/Borrower');
const LoanActivity = require('../../models/LoanActivity');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { createNotification } = require('../../utils/notificationHelper');
const imagekit = require('../../config/imagekit');
const mongoose = require('mongoose');

/**
 * @desc    Get data for borrower payment dashboard
 * @route   GET /api/borrower/payment-dashboard
 */
exports.getPaymentDashboard = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // 1. Resolve borrower identity (Profile or User ID)
  const borrower = await Borrower.findOne({ userId });
  const profileId = borrower ? borrower._id : null;

  // 2. Fetch active loan
  const loan = await ActiveLoan.findOne({ 
    $or: [{ borrowerId: profileId }, { borrowerId: userId }],
    isDeleted: false 
  }).sort({ createdAt: -1 });

  if (!loan) {
    return sendSuccess(res, 'No active loan found', {
        loan: null,
        nextEmi: null,
        remainingBalance: 0,
        pendingVerificationCount: 0,
        pendingPayments: [],
        recentPayments: []
    });
  }

  // 3. Find next unpaid EMI
  const nextEmi = await RepaymentSchedule.findOne({
    loanId: loan._id,
    status: { $in: ['Pending', 'Overdue'] }
  }).sort({ dueDate: 1 });

  // 4. Fetch pending verifications
  const pendingPayments = await Payment.find({
    loanId: loan._id,
    paymentStatus: 'Pending',
    isDeleted: false
  }).sort({ createdAt: -1 });

  // 5. Fetch recent payments (Verified or Rejected)
  const recentPayments = await Payment.find({
    loanId: loan._id,
    paymentStatus: { $in: ['Verified', 'Rejected'] },
    isDeleted: false
  }).sort({ createdAt: -1 }).limit(10);

  sendSuccess(res, 'Payment dashboard data retrieved', {
    loan: {
        _id: loan._id,
        loanCode: loan.loanCode,
        loanType: loan.loanType,
        approvedAmount: loan.approvedAmount,
        remainingBalance: loan.remainingBalance,
        penaltyAmount: loan.penaltyAmount
    },
    nextEmi,
    remainingBalance: loan.remainingBalance,
    pendingVerificationCount: pendingPayments.length,
    pendingPayments,
    recentPayments
  });
});

/**
 * @desc    Submit EMI payment with proof
 * @route   POST /api/borrower/submit-payment
 */
exports.submitPayment = asyncHandler(async (req, res) => {
  const { loanId, emiId, paymentAmount, paymentMethod, paymentDate, transactionReference } = req.body;
  const userId = req.user._id;

  // 1. Validation
  if (!loanId || !paymentAmount || !paymentMethod || !paymentDate || !transactionReference) {
    return sendError(res, 'All fields are required', 400);
  }

  // 2. Verify loan ownership
  const borrower = await Borrower.findOne({ userId });
  const profileId = borrower ? borrower._id : null;

  const loan = await ActiveLoan.findOne({ 
    _id: loanId, 
    $or: [{ borrowerId: profileId }, { borrowerId: userId }]
  });

  if (!loan) {
    return sendError(res, 'Loan not found or unauthorized', 404);
  }

  // 3. Handle File Upload (Payment Proof)
  let receiptUrl = '';
  let receiptFileId = '';

  if (req.file) {
    try {
      const uploadResponse = await imagekit.upload({
        file: req.file.buffer,
        fileName: `payment_proof_${Date.now()}_${req.file.originalname}`,
        folder: '/payments/proofs',
      });
      receiptUrl = uploadResponse.url;
      receiptFileId = uploadResponse.fileId;
    } catch (uploadError) {
      console.error('ImageKit Upload Error:', uploadError);
      return sendError(res, 'Failed to upload payment proof', 500);
    }
  } else {
    return sendError(res, 'Payment proof is required', 400);
  }

  // 4. Create Payment Submission
  const payment = await Payment.create({
    borrowerId: profileId || userId,
    borrowerName: req.user.fullName,
    borrowerPhone: req.user.phone,
    loanId: loan._id,
    loanCode: loan.loanCode,
    paymentAmount: Number(paymentAmount),
    paymentDate: new Date(paymentDate),
    paymentMethod,
    receiptImage: receiptUrl,
    receiptFile: receiptFileId,
    notes: transactionReference, // Use notes for transaction reference if no explicit field
    paymentStatus: 'Pending',
    paymentType: 'EMI Payment'
  });

  // 5. Log Activity
  await LoanActivity.create({
    loanId: loan._id,
    borrowerId: profileId || userId,
    type: 'Payment',
    title: 'Payment Submitted',
    message: `Payment of R${paymentAmount} submitted for verification. Ref: ${transactionReference}`,
    severity: 'info'
  });

  // 6. Notifications
  await createNotification({
    receiverRole: 'admin',
    title: 'New Payment Submission',
    message: `Borrower ${req.user.fullName} submitted a payment of R${paymentAmount}.`,
    type: 'Payment Submission',
    relatedId: payment._id,
    relatedModel: 'Payment'
  });

  await createNotification({
    receiverRole: 'staff',
    title: 'Payment Verification Required',
    message: `A new payment proof requires verification for loan ${loan.loanCode}.`,
    type: 'Payment Submission',
    relatedId: payment._id,
    relatedModel: 'Payment'
  });

  sendSuccess(res, 'Payment submitted successfully for verification', {
    paymentId: payment._id,
    transactionId: payment.transactionId,
    amount: payment.paymentAmount,
    status: 'Pending Verification'
  });
});

/**
 * @desc    Get borrower payment history with stats
 * @route   GET /api/borrower/payment-history
 */
exports.getPaymentHistory = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // 1. Resolve borrower identity
  const borrower = await Borrower.findOne({ userId });
  const profileId = borrower ? borrower._id : null;

  // 2. Fetch active loan
  const loan = await ActiveLoan.findOne({ 
    $or: [{ borrowerId: profileId }, { borrowerId: userId }],
    isDeleted: false 
  });

  if (!loan) {
    return sendSuccess(res, 'No loan records found', {
      stats: { totalPaidEmis: 0, totalPaidAmount: 0, pendingVerifications: 0, lastPaymentDate: null },
      transactions: [],
      paymentSummary: { totalPaid: 0, completedEmis: 0, balance: 0, penalties: 0 },
      activities: []
    });
  }

  // 3. Fetch transactions
  const transactions = await Payment.find({
    loanId: loan._id,
    isDeleted: false
  }).sort({ createdAt: -1 });

  // 4. Calculate Stats
  const verifiedPayments = transactions.filter(p => p.paymentStatus === 'Verified');
  const totalPaidAmount = verifiedPayments.reduce((sum, p) => sum + p.paymentAmount, 0);
  const pendingCount = transactions.filter(p => p.paymentStatus === 'Pending').length;
  const lastPayment = verifiedPayments.length > 0 ? verifiedPayments[0].paymentDate : null;

  // 5. Fetch Activities
  const activities = await LoanActivity.find({
    loanId: loan._id,
    borrowerId: profileId || userId
  }).sort({ createdAt: -1 }).limit(10);

  // 6. Payment Health Calculation
  const totalEmis = await RepaymentSchedule.countDocuments({ loanId: loan._id });
  const paidEmis = await RepaymentSchedule.countDocuments({ loanId: loan._id, status: 'Paid' });
  const overdueEmis = await RepaymentSchedule.countDocuments({ loanId: loan._id, status: 'Overdue' });

  let health = 'Excellent';
  if (overdueEmis > 2) health = 'Risky';
  else if (overdueEmis > 0) health = 'Moderate';

  sendSuccess(res, 'Payment history retrieved', {
    stats: {
      totalPaidEmis: paidEmis,
      totalPaidAmount,
      pendingVerifications: pendingCount,
      lastPaymentDate: lastPayment
    },
    transactions,
    paymentSummary: {
      totalPaid: totalPaidAmount,
      completedEmis: `${paidEmis} / ${totalEmis}`,
      balance: loan.remainingBalance,
      penalties: loan.penaltyAmount,
      health
    },
    activities
  });
});

/**
 * @desc    Get detailed receipt data
 * @route   GET /api/borrower/payment-receipt/:paymentId
 */
exports.getReceiptDetails = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const userId = req.user._id;

  const borrower = await Borrower.findOne({ userId });
  const profileId = borrower ? borrower._id : null;

  const payment = await Payment.findOne({
    _id: paymentId,
    $or: [{ borrowerId: profileId }, { borrowerId: userId }]
  });

  if (!payment) {
    return sendError(res, 'Receipt not found', 404);
  }

  const loan = await ActiveLoan.findById(payment.loanId);

  sendSuccess(res, 'Receipt details retrieved', {
    borrower: {
      fullName: req.user.fullName,
      phone: req.user.phone
    },
    loan: {
      loanCode: loan.loanCode,
      loanType: loan.loanType
    },
    payment: {
      transactionId: payment.transactionId,
      amount: payment.paymentAmount,
      date: payment.paymentDate,
      method: payment.paymentMethod,
      status: payment.paymentStatus,
      proof: payment.receiptImage,
      notes: payment.notes
    }
  });
});

/**
 * @desc    Download PDF receipt
 * @route   GET /api/borrower/download-receipt/:paymentId
 */
exports.downloadReceipt = asyncHandler(async (req, res) => {
  // Logic to generate PDF using pdfkit or similar
  // For now, returning success message as placeholder
  sendSuccess(res, 'PDF receipt generation logic goes here. Requires pdfkit.');
});

/**
 * @desc    Export history as PDF/Excel/CSV
 * @route   POST /api/borrower/export-payment-history
 */
exports.exportPaymentHistory = asyncHandler(async (req, res) => {
  sendSuccess(res, 'History export logic goes here. Requires exceljs/csv-writer.');
});

/**
 * @desc    Download full statement
 * @route   POST /api/borrower/download-payment-statement
 */
exports.downloadPaymentStatement = asyncHandler(async (req, res) => {
  sendSuccess(res, 'Statement generation logic goes here.');
});
