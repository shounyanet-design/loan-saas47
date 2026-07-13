const mongoose = require('mongoose');
const Payment = require('../../models/Payment');
const ActiveLoan = require('../../models/ActiveLoan');
const Borrower = require('../../models/Borrower');
const DuePayment = require('../../models/DuePayment');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { getIO } = require('../../socket/socketServer');
const { createNotification } = require('../../utils/notificationHelper');
const RepaymentSchedule = require('../../models/RepaymentSchedule');
const BorrowerAlert = require('../../models/BorrowerAlert');
const LoanActivity = require('../../models/LoanActivity');

/**
 * @desc    Get Staff Payment Verification Stats Summary
 * @route   GET /api/staff/payment-verification/overview
 */
const getPaymentVerificationOverview = asyncHandler(async (req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const pendingVerifications = await Payment.countDocuments({ paymentStatus: 'Pending', isDeleted: false });
  const verifiedPayments = await Payment.countDocuments({ paymentStatus: 'Verified', isDeleted: false });
  const rejectedProofs = await Payment.countDocuments({ paymentStatus: 'Rejected', isDeleted: false });
  
  const verifiedToday = await Payment.countDocuments({
    paymentStatus: 'Verified',
    verifiedBy: req.user._id,
    verifiedDate: { $gte: startOfToday, $lte: endOfToday },
    isDeleted: false
  });

  sendSuccess(res, 'Payment verification overview loaded successfully', {
    pendingVerifications,
    verifiedPayments,
    rejectedProofs,
    verifiedToday
  });
});

/**
 * @desc    Get Paginated & Filtered Payment Verification Queue
 * @route   GET /api/staff/payment-verification
 */
const getPaymentVerifications = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const query = { isDeleted: false };

  // Search filters: Borrower Name, Phone, Transaction ID, Loan ID (loanCode)
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    query.$or = [
      { borrowerName: searchRegex },
      { borrowerPhone: searchRegex },
      { transactionId: searchRegex },
      { loanCode: searchRegex }
    ];
  }

  // Field-level filters
  if (req.query.status) {
    query.paymentStatus = req.query.status;
  }
  if (req.query.method) {
    query.paymentMethod = req.query.method;
  }

  const total = await Payment.countDocuments(query);
  const payments = await Payment.find(query)
    .populate('borrowerId', 'profilePhoto')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const formatted = payments.map(p => {
    let proofType = 'Missing Proof';
    if (p.receiptFile) {
      proofType = 'Receipt Uploaded';
    } else if (p.receiptImage) {
      proofType = 'Screenshot Uploaded';
    }

    return {
      _id: p._id,
      paymentId: p.transactionId,
      borrowerId: p.borrowerId?._id || null,
      borrowerName: p.borrowerName,
      borrowerPhone: p.borrowerPhone,
      borrowerPhoto: p.borrowerPhoto || 'no-photo.jpg',
      loanId: p.loanCode,
      paymentAmount: p.paymentAmount,
      paymentMethod: p.paymentMethod,
      uploadedProofType: proofType,
      verificationStatus: p.paymentStatus,
      submittedDate: p.paymentDate || p.createdAt
    };
  });

  sendSuccess(res, 'Payment verification queue fetched successfully', {
    data: formatted,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  });
});

/**
 * @desc    Get Full Details of Single Payment Verification
 * @route   GET /api/staff/payment-verification/:id
 */
const getPaymentVerificationById = asyncHandler(async (req, res) => {
  const payment = await Payment.findOne({ _id: req.params.id, isDeleted: false })
    .populate('borrowerId')
    .populate('loanId');

  if (!payment) {
    return sendError(res, 'Payment not found', 404);
  }

  const activeLoan = payment.loanId;
  const borrower = payment.borrowerId;

  const result = {
    _id: payment._id,
    BORROWER: {
      fullName: borrower?.fullName || payment.borrowerName,
      email: borrower?.email || 'N/A',
      phone: borrower?.phoneNumber || payment.borrowerPhone,
      profilePhoto: borrower?.profilePhoto || payment.borrowerPhoto || 'no-photo.jpg'
    },
    LOAN: {
      loanId: activeLoan?.loanCode || payment.loanCode,
      loanType: activeLoan?.loanType || 'General Loan',
      remainingBalance: activeLoan?.remainingBalance || 0,
      overdueAmount: activeLoan?.penaltyAmount || 0
    },
    PAYMENT: {
      paymentAmount: payment.paymentAmount,
      paymentMethod: payment.paymentMethod,
      transactionId: payment.transactionId,
      paymentDate: payment.paymentDate,
      paymentNotes: payment.notes || ''
    },
    UPLOADED_PROOFS: {
      receipt: payment.receiptFile || null,
      screenshot: payment.receiptImage || null,
      depositSlip: null // For extra compatibility
    },
    VERIFICATION: {
      verificationStatus: payment.paymentStatus,
      verificationNotes: payment.notes || '',
      rejectionReason: payment.rejectionReason || ''
    }
  };

  sendSuccess(res, 'Payment verification details hydrated', result);
});

/**
 * @desc    Verify payment
 * @route   PUT /api/staff/payment-verification/:id/verify
 */
const verifyPayment = asyncHandler(async (req, res) => {
  const { verificationNotes } = req.body;

  const payment = await Payment.findOne({ _id: req.params.id, isDeleted: false });
  if (!payment) {
    return sendError(res, 'Payment record not found', 404);
  }

  if (payment.paymentStatus === 'Verified') {
    return sendError(res, 'Payment is already verified', 400);
  }

  // Rule 1: Only payments with uploaded proof can be verified
  if (!payment.receiptImage && !payment.receiptFile) {
    return sendError(res, 'Cannot verify payment without an uploaded proof', 400);
  }

  const activeLoan = await ActiveLoan.findById(payment.loanId);
  if (!activeLoan) {
    return sendError(res, 'Associated active loan not found', 404);
  }

  // 1. Update payment object
  payment.paymentStatus = 'Verified';
  payment.verifiedBy = req.user._id;
  payment.verifiedDate = new Date();
  if (verificationNotes) {
    payment.notes = verificationNotes;
  }

  // 2. Update Loan Balance
  activeLoan.remainingBalance = Math.max(0, activeLoan.remainingBalance - payment.paymentAmount);
  payment.remainingBalanceAfterPayment = activeLoan.remainingBalance;

  // 3. Update EMI Schedule
  let remainingAmountToApply = payment.paymentAmount;
  for (let i = 0; i < activeLoan.repaymentSchedule.length; i++) {
    const emi = activeLoan.repaymentSchedule[i];
    if (emi.paymentStatus !== 'Paid') {
      if (remainingAmountToApply >= emi.emiAmount) {
        emi.paymentStatus = 'Paid';
        emi.paidDate = new Date();
        remainingAmountToApply -= emi.emiAmount;

        // Sync with DuePayment if it exists
        await DuePayment.findOneAndUpdate(
          { loanId: activeLoan._id, installmentNumber: emi.installmentNumber },
          { dueStatus: 'Paid' }
        );

        // SYNC WITH NEW REPAYMENT SCHEDULE COLLECTION
        await RepaymentSchedule.findOneAndUpdate(
          { loanId: activeLoan._id, emiNumber: emi.installmentNumber },
          { 
            status: 'Paid', 
            paidAt: new Date(),
            lateDays: emi.paymentStatus === 'Overdue' ? Math.floor((new Date() - new Date(emi.dueDate)) / (1000 * 60 * 60 * 24)) : 0
          }
        );
      } else {
        break;
      }
    }
  }

  // 4. Find next pending EMI for due date
  const nextEmi = activeLoan.repaymentSchedule.find(s => s.paymentStatus === 'Pending' || s.paymentStatus === 'Overdue');
  activeLoan.nextDueDate = nextEmi ? nextEmi.dueDate : null;

  // 5. Mark loan as Completed if fully paid
  if (activeLoan.remainingBalance === 0) {
    activeLoan.loanStatus = 'Completed';
  }

  activeLoan.lastPaymentDate = new Date();

  await activeLoan.save();
  await payment.save();

  // 5.5 Update Agent Collections (If assigned)
  if (activeLoan.assignedAgent) {
    const Agent = require('../../models/Agent');
    const agent = await Agent.findById(activeLoan.assignedAgent);
    if (agent) {
      agent.totalCollections = (agent.totalCollections || 0) + payment.paymentAmount;
      await agent.save();

      // Notify Agent about collection update
      const io = getIO();
      if (io) {
        io.to(agent.userId.toString()).emit('agent:collectionReceived', {
          loanCode: activeLoan.loanCode,
          amount: payment.paymentAmount,
          borrowerName: activeLoan.borrowerName
        });
      }
    }
  }

  // 6. Create Borrower & Admin Notifications
  try {
    const borrower = await Borrower.findById(payment.borrowerId);
    
    // Notify Borrower
    await createNotification({
      receiverId: payment.borrowerId,
      receiverRole: 'borrower',
      senderId: req.user._id,
      senderRole: 'staff',
      notificationType: 'PaymentVerification',
      title: 'Payment Verified',
      message: `Your payment of R ${payment.paymentAmount} for Loan ${payment.loanCode} has been successfully verified.`,
      relatedId: payment._id,
      relatedModel: 'Payment',
      priority: 'normal'
    });

    // Create BorrowerAlert
    await BorrowerAlert.create({
      borrowerId: payment.borrowerId,
      title: 'Payment Verified',
      message: `Your payment of R ${payment.paymentAmount} has been verified and applied to your loan.`,
      alertType: 'PAYMENT_VERIFIED',
      priority: 'Medium'
    });

    // Log Activity
    await LoanActivity.create({
      loanId: activeLoan._id,
      borrowerId: payment.borrowerId,
      title: 'Payment Verified',
      message: `Staff ${req.user.fullName} verified payment of R ${payment.paymentAmount}.`,
      type: 'Payment'
    });

    // Notify Admin
    await createNotification({
      receiverRole: 'admin',
      senderId: req.user._id,
      senderRole: 'staff',
      notificationType: 'PaymentVerification',
      title: 'Incoming Collection Verified',
      message: `Staff ${req.user.fullName} has verified a payment of R ${payment.paymentAmount} for Loan ${payment.loanCode}.`,
      relatedId: payment._id,
      relatedModel: 'Payment',
      priority: 'important'
    });

    // 7. Real-time Broadcasts (Socket.IO)
    const io = getIO();
    if (borrower && borrower.userId) {
      const borrowerUserId = borrower.userId.toString();
      io.to(borrowerUserId).emit('payment-verified', { 
        paymentId: payment.transactionId, 
        amount: payment.paymentAmount,
        message: 'Your payment has been verified'
      });
      io.to(borrowerUserId).emit('dashboard-updated');
      io.to(borrowerUserId).emit('notification-created');
    }
    
    // General update for admin/staff
    io.emit('dashboard:updated', { trigger: 'payment_verified' });
    
  } catch (notifErr) {
    console.error('Notification dispatch error:', notifErr);
  }

  sendSuccess(res, 'Payment verified and processed successfully', { payment, activeLoan });
});

/**
 * @desc    Reject payment proof
 * @route   PUT /api/staff/payment-verification/:id/reject
 */
const rejectPayment = asyncHandler(async (req, res) => {
  const { rejectionReason, notes } = req.body;

  if (!rejectionReason) {
    return sendError(res, 'Rejection reason is mandatory', 400);
  }

  const payment = await Payment.findOne({ _id: req.params.id, isDeleted: false });
  if (!payment) {
    return sendError(res, 'Payment record not found', 404);
  }

  if (payment.paymentStatus === 'Verified') {
    return sendError(res, 'Cannot reject a payment that is already verified', 400);
  }

  payment.paymentStatus = 'Rejected';
  payment.rejectionReason = rejectionReason;
  payment.notes = notes || '';
  payment.verifiedBy = req.user._id;
  payment.verifiedDate = new Date();

  await payment.save();

  // Create Notifications
  try {
    // Notify Borrower
    await createNotification({
      receiverId: payment.borrowerId,
      receiverRole: 'borrower',
      senderId: req.user._id,
      senderRole: 'staff',
      notificationType: 'PaymentRejected',
      title: 'Payment Proof Rejected',
      message: `Your payment proof for R ${payment.paymentAmount} was rejected: ${rejectionReason}. Please upload a valid proof.`,
      relatedId: payment._id,
      relatedModel: 'Payment',
      priority: 'important'
    });

    // Notify Admin
    await createNotification({
      receiverRole: 'admin',
      senderId: req.user._id,
      senderRole: 'staff',
      notificationType: 'PaymentRejected',
      title: 'Payment Proof Rejected by Staff',
      message: `Staff ${req.user.fullName} rejected payment proof for transaction ${payment.transactionId}. Reason: ${rejectionReason}`,
      relatedId: payment._id,
      relatedModel: 'Payment',
      priority: 'normal'
    });
  } catch (notifErr) {}

  // Real-time Socket
  try {
    const io = getIO();
    io.emit('payment:rejected', { paymentId: payment.transactionId, reason: rejectionReason });
    io.emit('payment:updated', { paymentId: payment.transactionId, status: 'Rejected' });
    io.emit('dashboard:updated', { trigger: 'payment_rejected' });
  } catch (err) {}

  sendSuccess(res, 'Payment proof rejected successfully', { payment });
});

/**
 * @desc    Get Staff Verification Logs/History
 * @route   GET /api/staff/payment-verification/history
 */
const getVerificationHistory = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  // Return previously verified or rejected payments processed by this staff member
  const query = {
    verifiedBy: req.user._id,
    paymentStatus: { $in: ['Verified', 'Rejected'] },
    isDeleted: false
  };

  const total = await Payment.countDocuments(query);
  const payments = await Payment.find(query)
    .sort({ verifiedDate: -1 })
    .skip(skip)
    .limit(limit);

  const formatted = payments.map(p => ({
    _id: p._id,
    paymentId: p.transactionId,
    borrowerName: p.borrowerName,
    loanId: p.loanCode,
    paymentAmount: p.paymentAmount,
    paymentMethod: p.paymentMethod,
    verificationStatus: p.paymentStatus,
    processedDate: p.verifiedDate || p.updatedAt,
    rejectionReason: p.rejectionReason || null
  }));

  sendSuccess(res, 'Verification history logs loaded successfully', {
    data: formatted,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  });
});

/**
 * @desc    Manual Record Payment (Staff/Admin)
 * @route   POST /api/staff/payment-verification/manual
 */
const manualRecordPayment = asyncHandler(async (req, res) => {
  const { loanId, amount, paymentMethod, paymentDate, notes } = req.body;

  const activeLoan = await ActiveLoan.findById(loanId);
  if (!activeLoan) return sendError(res, 'Loan not found', 404);

  const payment = await Payment.create({
    borrowerId: activeLoan.borrowerId,
    borrowerName: activeLoan.borrowerName,
    borrowerPhone: activeLoan.borrowerPhone,
    loanId: activeLoan._id,
    loanCode: activeLoan.loanCode,
    paymentAmount: amount,
    paymentDate: paymentDate || new Date(),
    paymentMethod,
    paymentStatus: 'Verified',
    verifiedBy: req.user._id,
    verifiedDate: new Date(),
    notes: notes || 'Manually recorded by staff'
  });

  // Apply payment to balance and schedule (Simplified logic reuse)
  activeLoan.remainingBalance = Math.max(0, activeLoan.remainingBalance - amount);
  
  let remainingAmount = amount;
  for (let emi of activeLoan.repaymentSchedule) {
    if (emi.paymentStatus !== 'Paid' && remainingAmount >= emi.emiAmount) {
      emi.paymentStatus = 'Paid';
      emi.paidDate = new Date();
      remainingAmount -= emi.emiAmount;

      await RepaymentSchedule.findOneAndUpdate(
        { loanId: activeLoan._id, emiNumber: emi.installmentNumber },
        { status: 'Paid', paidAt: new Date() }
      );
    }
  }

  await activeLoan.save();

  sendSuccess(res, 'Manual payment recorded and verified', { payment, activeLoan });
});

/**
 * @desc    Mark Field Visit Follow-up
 * @route   POST /api/staff/payment-verification/field-visit
 */
const markFieldVisit = asyncHandler(async (req, res) => {
  const { loanId, borrowerId, outcome, notes, locationVerified } = req.body;

  // This could log to a new FieldVisit model or just update borrower/loan notes
  // For now, we'll update the loan notes and send a notification
  const activeLoan = await ActiveLoan.findById(loanId);
  if (!activeLoan) return sendError(res, 'Loan not found', 404);

  activeLoan.followUpHistory = activeLoan.followUpHistory || [];
  activeLoan.followUpHistory.push({
    date: new Date(),
    staffId: req.user._id,
    staffName: req.user.fullName,
    type: 'Field Visit',
    outcome,
    notes,
    locationVerified
  });

  await activeLoan.save();

  sendSuccess(res, 'Field visit outcome logged successfully');
});

module.exports = {
  getPaymentVerificationOverview,
  getPaymentVerifications,
  getPaymentVerificationById,
  verifyPayment,
  rejectPayment,
  getVerificationHistory,
  manualRecordPayment,
  markFieldVisit
};
