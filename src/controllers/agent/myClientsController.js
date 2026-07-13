const Borrower = require('../../models/Borrower');
const ActiveLoan = require('../../models/ActiveLoan');
const DuePayment = require('../../models/DuePayment');
const AgentClientActivity = require('../../models/AgentClientActivity');
const Notification = require('../../models/Notification');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');

/**
 * @desc    Get agent client dashboard analytics
 * @route   GET /api/agent/my-clients/dashboard
 * @access  Private/Agent
 */
exports.getClientDashboard = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // 1. Find all loans assigned to this agent
  const assignedLoans = await ActiveLoan.find({ assignedAgent: userId, isDeleted: false });
  
  // 2. Extract unique borrower IDs
  const borrowerIds = [...new Set(assignedLoans.map(l => l.borrowerId.toString()))];
  
  // 3. Stats based on assigned loans
  const assignedBorrowersCount = borrowerIds.length;
  const activeLoansCount = assignedLoans.filter(l => l.loanStatus === 'Active').length;
  const overdueBorrowersCount = assignedLoans.filter(l => l.loanStatus === 'Overdue').length;

  // 4. Due Payments (Upcoming EMI for these loans)
  const duePaymentsCount = await DuePayment.countDocuments({
    loanId: { $in: assignedLoans.map(l => l._id) },
    dueStatus: 'Due Today'
  });

  sendSuccess(res, 'Agent client dashboard data retrieved', {
    assignedBorrowers: assignedBorrowersCount,
    activeLoans: activeLoansCount,
    duePayments: duePaymentsCount,
    overdueBorrowers: overdueBorrowersCount
  });
});

/**
 * @desc    Get all assigned clients with filters and pagination
 * @route   GET /api/agent/my-clients
 * @access  Private/Agent
 */
exports.getClients = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 10, search = '', loanStatus = '', dueStatus = '' } = req.query;

  // 1. Find all active loans assigned to this agent's USER ID
  const query = { assignedAgent: userId, isDeleted: false };

  // Search logic (can search by borrower name or loan code)
  if (search) {
    query.$or = [
      { borrowerName: { $regex: search, $options: 'i' } },
      { loanCode: { $regex: search, $options: 'i' } },
      { borrowerPhone: { $regex: search, $options: 'i' } }
    ];
  }

  if (loanStatus && loanStatus !== 'All Statuses') {
    query.loanStatus = loanStatus;
  }

  const loans = await ActiveLoan.find(query)
    .sort({ assignedAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
    .lean(); // Use lean to get raw data

  const total = await ActiveLoan.countDocuments(query);

  const clients = await Promise.all(loans.map(async (loan) => {
    // Manually fetch borrower for additional fields (if exists)
    const borrower = await Borrower.findById(loan.borrowerId).select('borrowerCode profilePhoto').lean();

    // Get latest due payment
    const duePayment = await DuePayment.findOne({
      loanId: loan._id,
      dueStatus: { $ne: 'Paid' }
    }).sort({ dueDate: 1 });

    return {
      _id: loan._id,
      borrowerId: loan.borrowerId, // Always keep the raw ID from ActiveLoan
      borrowerName: loan.borrowerName,
      borrowerPhoto: loan.borrowerPhoto,
      borrowerCode: borrower ? borrower.borrowerCode : 'N/A',
      phone: loan.borrowerPhone,
      loanId: loan.loanCode,
      loanType: loan.loanType || 'Personal Loan',
      loanAmount: loan.approvedAmount,
      emiAmount: loan.emiAmount,
      remainingBalance: loan.remainingBalance,
      dueAmount: duePayment ? duePayment.totalDueAmount : 0,
      dueDate: duePayment ? duePayment.dueDate : loan.nextDueDate,
      loanStatus: loan.loanStatus,
      overdueDays: loan.overdueDays || 0,
      emiStatus: duePayment ? duePayment.dueStatus : 'Paid',
      priority: loan.recoveryPriority || 'Low'
    };
  }));

  sendSuccess(res, 'Assigned clients retrieved successfully', {
    clients,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit)
    }
  });
});

/**
 * @desc    Get single borrower details for drawer
 * @route   GET /api/agent/my-clients/:borrowerId
 * @access  Private/Agent
 */
exports.getBorrowerDetails = asyncHandler(async (req, res) => {
  const borrowerId = req.params.borrowerId;
  const userId = req.user._id;

  // 1. Check if ANY loan for this borrower is assigned to this agent
  const activeLoan = await ActiveLoan.findOne({ 
    borrowerId, 
    assignedAgent: userId, 
    isDeleted: false 
  }).sort({ createdAt: -1 });

  if (!activeLoan) {
    return sendError(res, 'Borrower not found or not assigned to you', 404);
  }

  const borrower = await Borrower.findById(borrowerId);
  // We continue even if borrower is null, using activeLoan data as fallback
  
  const duePayment = await DuePayment.findOne({
    borrowerId: activeLoan.borrowerId,
    dueStatus: { $ne: 'Paid' }
  }).sort({ dueDate: 1 });

  // Summary logic
  const loans = await ActiveLoan.find({ borrowerId });
  const totalLoanAmount = loans.reduce((acc, curr) => acc + curr.approvedAmount, 0);
  const totalRemaining = loans.reduce((acc, curr) => acc + curr.remainingBalance, 0);
  const totalPaid = totalLoanAmount - totalRemaining;
  const totalOverdue = loans.reduce((acc, curr) => acc + curr.penaltyAmount, 0);

  // Recent activities
  const activities = await AgentClientActivity.find({ borrowerId })
    .sort({ createdAt: -1 })
    .limit(10);

  sendSuccess(res, 'Borrower details retrieved', {
    profile: {
      fullName: borrower ? borrower.fullName : activeLoan.borrowerName,
      phone: borrower ? borrower.phoneNumber : activeLoan.borrowerPhone,
      email: borrower ? borrower.email : activeLoan.borrowerEmail,
      address: borrower ? borrower.physicalAddress : 'Address not in profile',
      borrowerStatus: borrower ? borrower.accountStatus : 'Active',
      borrowerCode: borrower ? borrower.borrowerCode : activeLoan.loanCode // Fallback to loan code
    },
    loan: activeLoan ? {
      loanId: activeLoan._id,
      loanCode: activeLoan.loanCode,
      loanType: activeLoan.loanType,
      loanAmount: activeLoan.approvedAmount,
      remainingBalance: activeLoan.remainingBalance,
      emiAmount: activeLoan.emiAmount,
      dueAmount: duePayment ? duePayment.totalDueAmount : 0,
      overdueAmount: activeLoan.penaltyAmount,
      overdueDays: activeLoan.overdueDays,
      repaymentProgress: activeLoan.approvedAmount > 0 
        ? ((activeLoan.approvedAmount - activeLoan.remainingBalance) / activeLoan.approvedAmount * 100).toFixed(1)
        : 0,
      nextDueDate: activeLoan.nextDueDate
    } : null,
    summary: {
      totalLoanAmount,
      totalPaid,
      remainingBalance: totalRemaining,
      overdueAmount: totalOverdue
    },
    activities: activities.map(a => ({
      id: a._id,
      type: a.type,
      title: a.type === 'FollowUp' ? `Follow-up: ${a.category}` : a.category,
      desc: a.notes,
      time: a.createdAt,
      color: a.type === 'FollowUp' ? 'blue' : 'emerald'
    }))
  });
});

/**
 * @desc    Save assistance record
 * @route   POST /api/agent/my-clients/assistance
 * @access  Private/Agent
 */
exports.saveAssistance = asyncHandler(async (req, res) => {
  const { borrowerId, supportType, supportNotes, communicationMessage } = req.body;
  const agentId = req.user._id;

  const activity = await AgentClientActivity.create({
    borrowerId,
    agentId,
    type: 'Assistance',
    category: supportType,
    notes: supportNotes,
    communicationMessage
  });

  // Notify borrower (mock logic, usually goes to Notifications collection)
  await Notification.create({
    receiverId: borrowerId,
    receiverRole: 'borrower',
    senderId: agentId,
    senderRole: 'agent',
    notificationType: 'AssistanceProvided',
    title: 'Support Assistance',
    message: `Your agent has recorded an assistance note: ${supportType}`,
    relatedId: activity._id,
    relatedModel: 'AgentClientActivity'
  });

  sendSuccess(res, 'Assistance record saved successfully', activity);
});

/**
 * @desc    Save payment follow-up
 * @route   POST /api/agent/my-clients/follow-up
 * @access  Private/Agent
 */
exports.saveFollowUp = asyncHandler(async (req, res) => {
  const { borrowerId, followUpType, followUpNotes, nextFollowUpDate } = req.body;
  const agentId = req.user._id;

  const activity = await AgentClientActivity.create({
    borrowerId,
    agentId,
    type: 'FollowUp',
    category: followUpType,
    notes: followUpNotes,
    nextFollowUpDate
  });

  sendSuccess(res, 'Follow-up record saved successfully', activity);
});

/**
 * @desc    Get recent activities for all assigned clients
 * @route   GET /api/agent/my-clients/activities
 * @access  Private/Agent
 */
exports.getRecentActivities = asyncHandler(async (req, res) => {
  const agentId = req.user._id;

  const activities = await AgentClientActivity.find({ agentId })
    .populate('borrowerId', 'fullName')
    .sort({ createdAt: -1 })
    .limit(20);

  sendSuccess(res, 'Recent activities retrieved', activities);
});
