const asyncHandler = require('express-async-handler');
const ActiveLoan = require('../../models/ActiveLoan');
const LoanApplication = require('../../models/LoanApplication');
const Payment = require('../../models/Payment');
const RepaymentSchedule = require('../../models/RepaymentSchedule');
const PlatformAuditLog = require('../../modules/platform/models/PlatformAuditLog');
const Agent = require('../../models/Agent');
const AgentAssignment = require('../../models/AgentAssignment');
const Notification = require('../../models/Notification');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { getIO } = require('../../socket/socketServer');

/**
 * @desc    Get all active loans with pagination, search, and filters
 * @route   GET /api/admin/active-loans
 * @access  Private/Admin
 */
const getAllActiveLoans = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    search = '',
    status,
    overdueStatus
  } = req.query;

  const query = { isDeleted: false };
  if (req.tenantId) {
    query.tenantId = req.tenantId;
  }

  // Search
  if (search) {
    query.$or = [
      { borrowerName: { $regex: search, $options: 'i' } },
      { loanCode: { $regex: search, $options: 'i' } },
      { borrowerPhone: { $regex: search, $options: 'i' } }
    ];
  }

  // Filters
  if (status && status !== 'All') {
    query.loanStatus = status;
  }
  if (overdueStatus) {
    query.overdueStatus = overdueStatus;
  }

  const skip = (page - 1) * limit;

  const activeLoans = await ActiveLoan.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  const Borrower = require('../../models/Borrower');
  const populatedLoans = await Promise.all(activeLoans.map(async (loan) => {
    const loanObj = loan.toObject();
    const appRecord = loanObj.loanApplicationId ? await LoanApplication.findById(loanObj.loanApplicationId).lean() : null;
    let borrowerDoc = null;
    if ((!loanObj.idNumber || !loanObj.residentialAddress) && loanObj.borrowerId) {
      borrowerDoc = await Borrower.findOne({
        $or: [{ _id: loanObj.borrowerId }, { userId: loanObj.borrowerId }]
      }).lean();
    }

    loanObj.fullName = loanObj.fullName || appRecord?.fullName || loanObj.borrowerName || borrowerDoc?.fullName || '';
    loanObj.borrowerName = loanObj.fullName;
    loanObj.emailAddress = loanObj.emailAddress || appRecord?.emailAddress || loanObj.borrowerEmail || borrowerDoc?.email || '';
    loanObj.borrowerEmail = loanObj.emailAddress;
    loanObj.phoneNumber = loanObj.phoneNumber || appRecord?.phoneNumber || loanObj.borrowerPhone || borrowerDoc?.phone || borrowerDoc?.phoneNumber || '';
    loanObj.borrowerPhone = loanObj.phoneNumber;
    loanObj.idNumber = loanObj.idNumber || appRecord?.idNumber || borrowerDoc?.idNumber || borrowerDoc?.idNumberSA || '';
    loanObj.residentialAddress = loanObj.residentialAddress || appRecord?.residentialAddress || borrowerDoc?.residentialAddress || borrowerDoc?.address || '';
    loanObj.applicationId = loanObj.applicationId || appRecord?.applicationId || loanObj.loanCode;
    loanObj.agreementSignedAt = loanObj.agreementSignedAt || appRecord?.agreementSignedAt || loanObj.createdAt;
    loanObj.agreementStatus = loanObj.agreementStatus || appRecord?.agreementStatus || 'SIGNED';
    loanObj.agreementGeneratedAt = loanObj.agreementGeneratedAt || appRecord?.agreementGeneratedAt || loanObj.createdAt;
    loanObj.verificationIp = loanObj.verificationIp || appRecord?.verificationIp || '196.25.255.250';
    loanObj.verificationUserAgent = loanObj.verificationUserAgent || appRecord?.verificationUserAgent || '';
    loanObj.processingFee = loanObj.processingFee || appRecord?.processingFee || 0;
    loanObj.agreementDocumentUrl = loanObj.agreementDocumentUrl || appRecord?.agreementDocumentUrl || '';
    loanObj.agreementCreditProviderSnapshot = (loanObj.agreementCreditProviderSnapshot && loanObj.agreementCreditProviderSnapshot.legalName)
      ? loanObj.agreementCreditProviderSnapshot
      : (appRecord?.agreementCreditProviderSnapshot && appRecord.agreementCreditProviderSnapshot.legalName
        ? appRecord.agreementCreditProviderSnapshot
        : null);
    loanObj.agreementFinancialSnapshot = loanObj.agreementFinancialSnapshot || appRecord?.agreementFinancialSnapshot || loanObj.financialSnapshot;
    loanObj.financialSnapshot = loanObj.financialSnapshot || appRecord?.financialSnapshot || loanObj.agreementFinancialSnapshot;
    return loanObj;
  }));

  const total = await ActiveLoan.countDocuments(query);

  sendSuccess(res, 'Active loans fetched successfully', {
    activeLoans: populatedLoans,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit)
    }
  });
});

/**
 * @desc    Get dashboard stats
 * @route   GET /api/admin/active-loans/stats
 * @access  Private/Admin
 */
const getDashboardStats = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const baseQuery = { isDeleted: false };
  if (tenantId) baseQuery.tenantId = tenantId;

  const totalLoans = await ActiveLoan.countDocuments(baseQuery);
  const totalActiveLoans = await ActiveLoan.countDocuments({ ...baseQuery, loanStatus: 'Active' });
  const overdueLoans = await ActiveLoan.countDocuments({ ...baseQuery, loanStatus: 'Overdue' });
  const completedLoans = await ActiveLoan.countDocuments({ ...baseQuery, loanStatus: 'Completed' });
  const closedLoans = await ActiveLoan.countDocuments({ ...baseQuery, loanStatus: 'Closed' });

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0,0,0,0);
  const completedThisMonth = await ActiveLoan.countDocuments({ 
    ...baseQuery,
    loanStatus: 'Completed', 
    updatedAt: { $gte: startOfMonth }
  });

  const matchQuery = { isDeleted: false, loanStatus: { $in: ['Active', 'Overdue'] } };
  if (tenantId) {
    const mongoose = require('mongoose');
    matchQuery.tenantId = new mongoose.Types.ObjectId(tenantId);
  }

  const aggregate = await ActiveLoan.aggregate([
    { $match: matchQuery },
    { $group: { _id: null, totalRemaining: { $sum: '$remainingBalance' } } }
  ]);

  const outstandingBalance = aggregate.length > 0 ? aggregate[0].totalRemaining : 0;

  sendSuccess(res, 'Stats fetched successfully', {
    totalLoans,
    totalActiveLoans,
    outstandingBalance,
    overdueLoans,
    completedLoans,
    closedLoans,
    completedThisMonth
  });
});

/**
 * @desc    Get overdue loans only
 * @route   GET /api/admin/active-loans/overdue
 * @access  Private/Admin
 */
const getOverdueLoans = asyncHandler(async (req, res) => {
  const query = { loanStatus: 'Overdue', isDeleted: false };
  if (req.tenantId) query.tenantId = req.tenantId;
  const overdueLoans = await ActiveLoan.find(query);
  sendSuccess(res, 'Overdue loans fetched successfully', { activeLoans: overdueLoans });
});

/**
 * @desc    Get completed loans only
 * @route   GET /api/admin/active-loans/completed
 * @access  Private/Admin
 */
const getCompletedLoans = asyncHandler(async (req, res) => {
  const query = { loanStatus: 'Completed', isDeleted: false };
  if (req.tenantId) query.tenantId = req.tenantId;
  const completedLoans = await ActiveLoan.find(query);
  sendSuccess(res, 'Completed loans fetched successfully', { activeLoans: completedLoans });
});

/**
 * @desc    Get export ready data
 * @route   GET /api/admin/active-loans/export
 * @access  Private/Admin
 */
const exportLoanData = asyncHandler(async (req, res) => {
  const query = { isDeleted: false };
  if (req.tenantId) query.tenantId = req.tenantId;
  const activeLoans = await ActiveLoan.find(query).lean();
  sendSuccess(res, 'Export data ready', { activeLoans });
});

/**
 * @desc    Get due payments (upcoming & overdue)
 * @route   GET /api/admin/active-loans/due-payments
 * @access  Private/Admin
 */
const getDuePayments = asyncHandler(async (req, res) => {
  const query = { isDeleted: false, loanStatus: { $in: ['Active', 'Overdue'] } };
  if (req.tenantId) query.tenantId = req.tenantId;
  const activeLoans = await ActiveLoan.find(query);
  
  let duePayments = [];
  const now = new Date();

  activeLoans.forEach(loan => {
    const pendingInstallments = (loan.repaymentSchedule || []).filter(s => s.paymentStatus === 'Pending' || s.paymentStatus === 'Overdue');
    pendingInstallments.forEach(inst => {
      duePayments.push({
        loanId: loan._id,
        loanCode: loan.loanCode,
        borrowerName: loan.borrowerName || loan.fullName,
        borrowerPhone: loan.borrowerPhone || loan.phoneNumber,
        installmentNumber: inst.installmentNumber,
        dueDate: inst.dueDate,
        emiAmount: inst.emiAmount,
        paymentStatus: inst.paymentStatus,
        isOverdue: new Date(inst.dueDate) < now
      });
    });
  });

  // Sort by due date (oldest first)
  duePayments.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  sendSuccess(res, 'Due payments fetched successfully', { duePayments });
});

/**
 * @desc    Get single loan details with authoritative servicing summary
 * @route   GET /api/admin/active-loans/:id
 * @access  Private/Admin
 */
const getLoanDetails = asyncHandler(async (req, res) => {
  const activeLoan = await ActiveLoan.findOne({ _id: req.params.id, isDeleted: false });
  
  if (!activeLoan) {
    return sendError(res, 'Loan not found', 404);
  }

  const loanObj = activeLoan.toObject();
  if (!loanObj.fullName || !loanObj.applicationId) {
    const appRecord = await LoanApplication.findById(loanObj.loanApplicationId);
    if (appRecord) {
      loanObj.fullName = loanObj.fullName || appRecord.fullName;
      loanObj.emailAddress = loanObj.emailAddress || appRecord.emailAddress;
      loanObj.phoneNumber = loanObj.phoneNumber || appRecord.phoneNumber;
      loanObj.idNumber = loanObj.idNumber || appRecord.idNumber;
      loanObj.applicationId = loanObj.applicationId || appRecord.applicationId;
      loanObj.agreementSignedAt = loanObj.agreementSignedAt || appRecord.agreementSignedAt;
      loanObj.agreementStatus = loanObj.agreementStatus || appRecord.agreementStatus;
      loanObj.agreementGeneratedAt = loanObj.agreementGeneratedAt || appRecord.agreementGeneratedAt;
      loanObj.verificationIp = loanObj.verificationIp || appRecord.verificationIp;
      loanObj.verificationUserAgent = loanObj.verificationUserAgent || appRecord.verificationUserAgent;
      loanObj.processingFee = loanObj.processingFee || appRecord.processingFee;
      loanObj.agreementDocumentUrl = loanObj.agreementDocumentUrl || appRecord.agreementDocumentUrl;
    }
  }

  // 1. Authoritative Payments Query (tenant-scoped via plugin/filter)
  const verifiedPayments = await Payment.find({
    loanId: activeLoan._id,
    paymentStatus: 'Verified',
    isDeleted: false
  }).sort({ paymentDate: -1, createdAt: -1 });

  const totalPaid = verifiedPayments.reduce((sum, p) => sum + (Number(p.paymentAmount) || 0), 0);

  // 2. Authoritative Repayment Schedule Query
  let schedule = await RepaymentSchedule.find({ loanId: activeLoan._id }).sort({ emiNumber: 1 });
  if (!schedule || schedule.length === 0) {
    schedule = (activeLoan.repaymentSchedule || []).map(emi => ({
      _id: emi._id,
      loanId: activeLoan._id,
      borrowerId: activeLoan.borrowerId,
      emiNumber: emi.installmentNumber,
      dueDate: emi.dueDate,
      amount: emi.emiAmount,
      status: emi.paymentStatus === 'Paid' ? 'Paid' : (emi.paymentStatus === 'Overdue' ? 'Overdue' : 'Pending'),
      paidAt: emi.paidDate || null,
      penaltyAmount: emi.lateFee || 0
    }));
  }

  const totalInstallments = schedule.length || activeLoan.loanDurationMonths || 1;
  const paidInstallments = schedule.filter(s => s.status === 'Paid' || s.status === 'Late Paid' || s.paymentStatus === 'Paid').length;

  const now = new Date();
  const overdueInstallments = schedule.filter(s => {
    const isUnpaid = s.status !== 'Paid' && s.status !== 'Late Paid' && s.paymentStatus !== 'Paid';
    return isUnpaid && new Date(s.dueDate) < now;
  });
  const overdueAmount = overdueInstallments.reduce((sum, s) => sum + (Number(s.amount || s.emiAmount) || 0), 0);

  const upcomingUnpaid = schedule.find(s => s.status !== 'Paid' && s.status !== 'Late Paid' && s.paymentStatus !== 'Paid');
  const nextEmiDate = upcomingUnpaid ? upcomingUnpaid.dueDate : (activeLoan.nextDueDate || null);

  const totalPayable = Number(activeLoan.totalPayableAmount) || Number(activeLoan.approvedAmount) || 1;
  const remainingBalance = typeof activeLoan.remainingBalance === 'number'
    ? activeLoan.remainingBalance
    : Math.max(0, totalPayable - totalPaid);

  const financialProgressPercent = totalPayable > 0
    ? Math.min(100, Math.max(0, Math.round((totalPaid / totalPayable) * 100)))
    : 0;

  const installmentProgressPercent = totalInstallments > 0
    ? Math.min(100, Math.max(0, Math.round((paidInstallments / totalInstallments) * 100)))
    : 0;

  const servicingSummary = {
    totalPaid,
    remainingBalance,
    overdueAmount,
    totalPenalties: activeLoan.penaltyAmount || 0,
    paidInstallments,
    totalInstallments,
    financialProgressPercent,
    installmentProgressPercent,
    nextEmiDate
  };

  sendSuccess(res, 'Loan details fetched successfully', {
    activeLoan: {
      ...loanObj,
      totalPaid,
      servicingSummary
    },
    servicingSummary,
    recentPayments: verifiedPayments.slice(0, 10),
    repaymentSchedule: schedule
  });
});

/**
 * @desc    Get financial settlement quote for active loan
 * @route   GET /api/admin/active-loans/:id/settlement-quote
 * @access  Private/Admin
 */
const getSettlementQuote = asyncHandler(async (req, res) => {
  const query = { _id: req.params.id, isDeleted: false };
  if (req.tenantId) query.tenantId = req.tenantId;

  const activeLoan = await ActiveLoan.findOne(query);
  if (!activeLoan) {
    return sendError(res, 'Active loan not found', 404);
  }

  const verifiedPayments = await Payment.find({
    loanId: activeLoan._id,
    paymentStatus: 'Verified',
    isDeleted: false
  });
  const totalPaid = verifiedPayments.reduce((sum, p) => sum + (Number(p.paymentAmount) || 0), 0);

  const totalPayable = Number(activeLoan.totalPayableAmount) || Number(activeLoan.approvedAmount) || 0;
  const currentBalance = typeof activeLoan.remainingBalance === 'number'
    ? activeLoan.remainingBalance
    : Math.max(0, totalPayable - totalPaid);

  const unpaidPenalties = Number(activeLoan.penaltyAmount) || 0;
  const settlementAmount = Math.max(0, currentBalance);
  const isSettled = activeLoan.loanStatus === 'Completed' || currentBalance === 0;

  const quote = {
    loanId: activeLoan._id,
    loanCode: activeLoan.loanCode,
    borrowerName: activeLoan.borrowerName || activeLoan.fullName,
    approvedAmount: activeLoan.approvedAmount,
    totalPayableAmount: totalPayable,
    totalPaid,
    currentBalance,
    unpaidPenalties,
    settlementAmount,
    settlementDate: new Date(),
    isSettled,
    loanStatus: activeLoan.loanStatus
  };

  sendSuccess(res, 'Settlement quote calculated successfully', { settlementQuote: quote });
});

/**
 * @desc    Execute production-safe financial settlement for active loan
 * @route   POST /api/admin/active-loans/:id/settle
 * @access  Private/Admin
 */
const settleLoan = asyncHandler(async (req, res) => {
  const { paymentMethod = 'Bank Transfer', transactionId, paymentAmount, notes } = req.body;

  const query = { _id: req.params.id, isDeleted: false };
  if (req.tenantId) query.tenantId = req.tenantId;

  const activeLoan = await ActiveLoan.findOne(query);
  if (!activeLoan) {
    return sendError(res, 'Active loan not found', 404);
  }

  if (activeLoan.loanStatus === 'Completed' || activeLoan.remainingBalance === 0) {
    return sendError(res, 'Loan is already settled and completed.', 400);
  }

  const requiredAmount = activeLoan.remainingBalance;
  const numPaymentAmount = Number(paymentAmount) || requiredAmount;

  if (numPaymentAmount <= 0) {
    return sendError(res, 'Settlement payment amount must be greater than zero.', 400);
  }

  const trxRef = transactionId || `SETTLE-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const mongoose = require('mongoose');
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Create Verified Payment record
    const [settlementPayment] = await Payment.create([{
      tenantId: activeLoan.tenantId,
      borrowerId: activeLoan.borrowerId,
      borrowerName: activeLoan.borrowerName || activeLoan.fullName || 'Borrower',
      borrowerPhone: activeLoan.borrowerPhone || activeLoan.phoneNumber,
      loanId: activeLoan._id,
      loanCode: activeLoan.loanCode,
      transactionId: trxRef,
      paymentAmount: numPaymentAmount,
      paymentDate: new Date(),
      paymentMethod: ['Bank Transfer', 'EFT', 'Cash Deposit', 'Mobile Payment', 'Debit Order'].includes(paymentMethod) ? paymentMethod : 'Bank Transfer',
      paymentStatus: 'Verified',
      paymentType: 'Full Settlement',
      verifiedBy: req.user._id,
      verifiedDate: new Date(),
      remainingBalanceAfterPayment: 0,
      notes: notes || 'Full loan settlement payment verified by admin.'
    }], { session });

    // 2. Allocate payment to RepaymentSchedule collection
    await RepaymentSchedule.updateMany(
      { loanId: activeLoan._id, status: { $ne: 'Paid' } },
      { $set: { status: 'Paid', paidAt: new Date() } },
      { session }
    );

    // 3. Update ActiveLoan document
    activeLoan.remainingBalance = 0;
    activeLoan.loanStatus = 'Completed';
    activeLoan.nextDueDate = null;
    activeLoan.settledAt = new Date();
    activeLoan.settledBy = req.user._id;

    if (Array.isArray(activeLoan.repaymentSchedule)) {
      activeLoan.repaymentSchedule.forEach(s => {
        s.paymentStatus = 'Paid';
        s.paidDate = new Date();
      });
    }

    await activeLoan.save({ session });

    // 4. Record PlatformAuditLog
    await PlatformAuditLog.create([{
      tenantId: activeLoan.tenantId,
      userId: req.user._id,
      action: 'LOAN_SETTLED',
      entity: 'ActiveLoan',
      entityId: activeLoan._id,
      description: `Loan ${activeLoan.loanCode} fully settled with payment reference ${trxRef} of R ${numPaymentAmount}.`,
      createdAt: new Date()
    }], { session });

    await session.commitTransaction();
    session.endSession();

    // Trigger real-time notifications
    try {
      const io = getIO();
      if (io) {
        io.emit('loan:settled', { loanId: activeLoan._id, loanCode: activeLoan.loanCode, amount: numPaymentAmount });
        io.emit('dashboard:updated', { trigger: 'loan_settlement' });
      }
    } catch (_) {}

    return sendSuccess(res, 'Loan successfully settled and completed.', {
      activeLoan,
      payment: settlementPayment
    }, 201);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('[ActiveLoanController] Settlement transaction failed:', err.message);
    return sendError(res, err.message || 'Settlement workflow failed', 500);
  }
});

/**
 * @desc    Update loan status / Settle loan safely
 * @route   PUT /api/admin/active-loans/:id/status
 * @access  Private/Admin
 */
const updateLoanStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['Active', 'Overdue', 'Completed', 'Closed'];

  if (!validStatuses.includes(status)) {
    return sendError(res, 'Invalid loan status', 400);
  }

  const activeLoan = await ActiveLoan.findOne({ _id: req.params.id, isDeleted: false });

  if (!activeLoan) {
    return sendError(res, 'Loan not found', 404);
  }

  activeLoan.loanStatus = status;
  await activeLoan.save();

  sendSuccess(res, 'Loan status updated successfully', { activeLoan });
});

/**
 * @desc    Add admin notes to loan
 * @route   PUT /api/admin/active-loans/:id/notes
 * @access  Private/Admin
 */
const addAdminNotes = asyncHandler(async (req, res) => {
  const { notes } = req.body;

  const activeLoan = await ActiveLoan.findOne({ _id: req.params.id, isDeleted: false });

  if (!activeLoan) {
    return sendError(res, 'Loan not found', 404);
  }

  activeLoan.notes = notes;
  await activeLoan.save();

  sendSuccess(res, 'Admin notes added successfully', { activeLoan });
});

/**
 * @desc    Close an active loan (admin-only — required before deletion)
 * @route   PUT /api/admin/active-loans/:id/close
 * @access  Private/Admin
 */
const closeLoan = asyncHandler(async (req, res) => {
  const { closureReason, closureNotes } = req.body;

  if (!closureReason) {
    return sendError(res, 'Closure reason is required', 400);
  }

  const activeLoan = await ActiveLoan.findOne({ _id: req.params.id, isDeleted: false });

  if (!activeLoan) {
    return sendError(res, 'Loan not found', 404);
  }

  if (activeLoan.loanStatus === 'Closed') {
    return sendError(res, 'Loan is already closed', 400);
  }

  // Apply closure
  activeLoan.loanStatus = 'Closed';
  activeLoan.closedAt = new Date();
  activeLoan.closedBy = req.user._id;
  activeLoan.closureReason = closureReason;
  activeLoan.closureNotes = closureNotes || '';

  await activeLoan.save();

  // Emit real-time update
  try {
    const io = getIO();
    if (io) {
      io.emit('loan:closed', {
        loanId: activeLoan._id,
        loanCode: activeLoan.loanCode,
        closureReason
      });
      io.emit('dashboard:updated', { trigger: 'loan_closure' });
    }
  } catch (ioErr) {}

  sendSuccess(res, 'Loan closed successfully', { activeLoan });
});

/**
 * @desc    Permanently delete a CLOSED loan with full cascade removal
 * @route   DELETE /api/admin/active-loans/:id
 * @access  Private/Admin
 *
 * SECURITY RULE: Only loans with loanStatus === 'Closed' can be deleted.
 * Deletion cascades to RepaymentSchedule and Payment records.
 */
const deleteLoan = asyncHandler(async (req, res) => {
  const activeLoan = await ActiveLoan.findOne({ _id: req.params.id, isDeleted: false });

  if (!activeLoan) {
    return sendError(res, 'Loan not found', 404);
  }

  // Hard security gate — enforce close-before-delete
  if (activeLoan.loanStatus !== 'Closed') {
    return sendError(
      res,
      'Only closed loans can be deleted. Please close the loan first before attempting deletion.',
      400
    );
  }

  const mongoose = require('mongoose');
  const RepaymentSchedule = require('../../models/RepaymentSchedule');
  const Payment = require('../../models/Payment');
  const DuePayment = require('../../models/DuePayment');
  const AgentAssignment = require('../../models/AgentAssignment');
  const Commission = require('../../models/Commission');
  const LoanActivity = require('../../models/LoanActivity');

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Cascade delete: remove all linked repayment schedules
    await RepaymentSchedule.deleteMany(
      { activeLoanId: activeLoan._id },
      { session }
    );

    // Cascade delete: remove all linked payment records
    await Payment.deleteMany(
      { activeLoanId: activeLoan._id },
      { session }
    );

    // Cascade delete: remove all linked due payment records
    await DuePayment.deleteMany(
      { loanId: activeLoan._id },
      { session }
    );

    // Cascade delete: remove all linked agent assignments
    await AgentAssignment.deleteMany(
      { loanId: activeLoan._id },
      { session }
    );

    // Cascade delete: remove all linked commissions
    await Commission.deleteMany(
      { loanId: activeLoan._id },
      { session }
    );

    // Cascade delete: remove all linked loan activities
    await LoanActivity.deleteMany(
      { loanId: activeLoan._id },
      { session }
    );

    // Hard delete the active loan itself
    await ActiveLoan.deleteOne({ _id: activeLoan._id }, { session });

    await session.commitTransaction();
    session.endSession();

    // Emit real-time update to refresh all dashboards
    try {
      const io = getIO();
      if (io) {
        io.emit('loan:deleted', {
          loanId: activeLoan._id,
          loanCode: activeLoan.loanCode
        });
        io.emit('dashboard:updated', { trigger: 'loan_deletion' });
      }
    } catch (ioErr) {}

    sendSuccess(res, 'Loan and all linked records permanently deleted');
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    console.error('Loan deletion cascade error:', err);
    return sendError(res, 'Deletion failed: ' + err.message, 500);
  }
});

/**
 * @desc    Assign an agent to an active loan
 * @route   POST /api/admin/active-loans/assign-agent
 * @access  Private/Admin
 */
const assignAgent = asyncHandler(async (req, res) => {
  const { loanId, agentId, notes, priority } = req.body;

  if (!loanId || !agentId) {
    return sendError(res, 'Loan ID and Agent ID are required', 400);
  }

  // 1. Validate Loan
  const activeLoan = await ActiveLoan.findOne({ _id: loanId, isDeleted: false });
  if (!activeLoan) {
    return sendError(res, 'Loan not found', 404);
  }

  if (activeLoan.loanStatus !== 'Active') {
    return sendError(res, 'Only active loans can be assigned', 400);
  }

  if (activeLoan.assignedAgent) {
    return sendError(res, 'Loan already assigned to an agent', 400);
  }

  // 2. Validate Agent
  const agent = await Agent.findOne({ _id: agentId, isDeleted: false });
  if (!agent) {
    return sendError(res, 'Agent not found', 404);
  }

  if (agent.accountStatus !== 'Active') {
    return sendError(res, 'Cannot assign an inactive or suspended agent', 400);
  }

  // 3. Update Active Loan
  activeLoan.assignedAgent = agent.userId; // Store User ID as requested
  activeLoan.assignedAt = new Date();
  activeLoan.assignedBy = req.user._id;
  activeLoan.recoveryPriority = priority || 'Low';
  await activeLoan.save();

  // 3.4 Update Borrower's Assigned Agent
  try {
    const Borrower = require('../../models/Borrower');
    await Borrower.findByIdAndUpdate(activeLoan.borrowerId, {
      assignedAgent: agent.userId
    });
  } catch (borrErr) {
    console.error('Borrower assignment sync failed:', borrErr.message);
  }

  // 3.5 Create Communication Thread (Borrower, Agent, Admin)
  try {
    const Conversation = require('../../models/Conversation');
    // Check if conversation already exists for these participants (simplified: just create new for this loan context)
    await Conversation.create({
      participants: [activeLoan.borrowerId, agent.userId, req.user._id],
      participantRoles: ['borrower', 'agent', 'admin'],
      conversationType: 'Agent',
      lastMessage: 'Collection agent assigned to loan recovery.',
      lastMessageAt: new Date(),
      createdBy: req.user._id,
      status: 'active'
    });
  } catch (convErr) {
    console.error('Conversation creation failed:', convErr.message);
  }

  // 4. Create Agent Assignment Record
  await AgentAssignment.create({
    loanId,
    borrowerId: activeLoan.borrowerId,
    agentId,
    assignedBy: req.user._id,
    notes,
    status: 'Active'
  });

  // 4.5 Create Commission Record
  try {
    const Commission = require('../../models/Commission');
    const commissionPercent = 2.5;
    const commissionAmount = (activeLoan.approvedAmount * commissionPercent) / 100;

    await Commission.create({
      agentId: agent.userId,
      borrowerId: activeLoan.borrowerId,
      loanId: activeLoan._id,
      loanAmount: activeLoan.approvedAmount,
      commissionPercent,
      commissionAmount,
      status: 'Pending'
    });
  } catch (commErr) {
    console.error('Commission record creation failed:', commErr.message);
  }

  // 5. Update Agent's assignedBorrowers list
  if (!agent.assignedBorrowers.includes(activeLoan.borrowerId)) {
    agent.assignedBorrowers.push(activeLoan.borrowerId);
    await agent.save();
  }

  // 6. Create Notifications & Socket Events
  try {
    await Notification.create({
      receiverId: agent.userId,
      receiverRole: 'agent',
      title: 'New Client Assigned',
      message: 'New borrower assigned to your portfolio',
      notificationType: 'NEW_ASSIGNMENT',
      priority: 'Important',
      applicationId: activeLoan.loanApplicationId
    });

    const io = getIO();
    if (io) {
      io.to(agent.userId.toString()).emit('new-agent-assignment', {
        loanCode: activeLoan.loanCode,
        borrowerName: activeLoan.borrowerName,
        priority: activeLoan.recoveryPriority,
        message: 'A new collection client has been assigned to you.'
      });
    }
  } catch (notifErr) {
    console.error('Assignment notification failed:', notifErr.message);
  }

  sendSuccess(res, 'Agent assigned successfully', { activeLoan });
});

module.exports = {
  getAllActiveLoans,
  getDashboardStats,
  getOverdueLoans,
  getCompletedLoans,
  exportLoanData,
  getDuePayments,
  getLoanDetails,
  updateLoanStatus,
  addAdminNotes,
  closeLoan,
  deleteLoan,
  assignAgent,
  getSettlementQuote,
  settleLoan
};
