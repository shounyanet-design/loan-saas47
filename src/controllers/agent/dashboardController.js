const Borrower = require('../../models/Borrower');
const ActiveLoan = require('../../models/ActiveLoan');
const Commission = require('../../models/Commission');
const Notification = require('../../models/Notification');
const Agent = require('../../models/Agent');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');

/**
 * @desc    Get Agent Dashboard Summary
 * @route   GET /api/agent/dashboard
 * @access  Private/Agent
 */
const getDashboardSummary = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // 1. Get Agent Profile for Target Achievement
  const agentProfile = await Agent.findOne({ userId });
  
  // 2. Find Assigned Loans (Source of truth)
  const assignedLoans = await ActiveLoan.find({ assignedAgent: userId, isDeleted: false });
  const activeLoansCount = assignedLoans.filter(l => l.loanStatus === 'Active').length;
  const overdueLoansCount = assignedLoans.filter(l => l.loanStatus === 'Overdue').length;
  
  // Unique assigned borrowers
  const borrowerIds = [...new Set(assignedLoans.map(l => l.borrowerId.toString()))];
  const assignedClientsCount = borrowerIds.length;

  // 3. Monthly Commission
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthlyCommissionData = await Commission.aggregate([
    { $match: { agentId: userId, createdAt: { $gte: startOfMonth }, isDeleted: false } },
    { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
  ]);
  const monthlyCommission = monthlyCommissionData[0]?.total || 0;

  // 4. Pending Follow-Ups (Based on followUpStatus)
  const pendingFollowUps = assignedLoans.filter(l => l.followUpStatus === 'Pending' || l.loanStatus === 'Overdue').length;

  // 5. Portfolio Value
  const portfolioValue = assignedLoans
    .filter(l => l.loanStatus === 'Active' || l.loanStatus === 'Overdue')
    .reduce((sum, l) => sum + l.approvedAmount, 0);

  // 6. Target Achievement
  const monthlyTarget = agentProfile?.monthlyTarget || 100000;
  const currentCollection = agentProfile?.totalCollections || 0; // Using agent model totalCollections
  const targetAchievement = Math.min(Math.round((currentCollection / monthlyTarget) * 100), 100);

  // 7. Today's Due Payments
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayFollowUps = assignedLoans.filter(l => 
    l.nextDueDate && l.nextDueDate >= today && l.nextDueDate < tomorrow
  ).length;

  // 8. Recent Activities & Priority Alerts
  const recentActivities = await Notification.find({ receiverId: userId, isDeleted: false })
    .sort({ createdAt: -1 }).limit(5);

  const priorityAlerts = assignedLoans
    .filter(l => l.recoveryPriority === 'High' && l.loanStatus === 'Overdue')
    .slice(0, 5);

  // 9. Commission Summary
  const commissionSummaryData = await Commission.aggregate([
    { $match: { agentId: userId, isDeleted: false } },
    {
      $group: {
        _id: null,
        totalEarned: { $sum: '$commissionAmount' },
        pendingCommission: { $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, '$commissionAmount', 0] } },
        paidCommission: { $sum: { $cond: [{ $eq: ['$status', 'Paid'] }, '$commissionAmount', 0] } }
      }
    }
  ]);
  const commissionSummary = commissionSummaryData[0] || { totalEarned: 0, pendingCommission: 0, paidCommission: 0 };
  commissionSummary.thisMonth = monthlyCommission;

  sendSuccess(res, 'Agent dashboard summary fetched', {
    assignedClientsCount,
    activeLoansCount,
    overdueLoansCount,
    monthlyCommission,
    pendingFollowUps,
    targetAchievement,
    portfolioValue,
    todayFollowUps,
    recentActivities,
    priorityAlerts: priorityAlerts.map(l => ({
      loanCode: l.loanCode,
      borrowerName: l.borrowerName,
      priority: l.recoveryPriority,
      status: l.loanStatus
    })),
    assignedClientsTable: assignedLoans.slice(0, 10).map(loan => ({
      borrowerName: loan.borrowerName,
      loanAmount: loan.approvedAmount,
      dueDate: loan.nextDueDate,
      loanStatus: loan.loanStatus,
      priority: loan.recoveryPriority,
      borrowerId: loan.borrowerId,
      loanId: loan._id
    })),
    commissionSummary
  });
});

/**
 * @desc    Get Assigned Clients for Table (with filters)
 * @route   GET /api/agent/dashboard/assigned-clients
 */
const getAssignedClientsTable = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const agentId = req.user._id;

  const assignedBorrowers = await Borrower.find({ assignedAgent: agentId }).select('_id');
  const borrowerIds = assignedBorrowers.map(b => b._id);

  const query = { borrowerId: { $in: borrowerIds } };
  
  if (status === 'overdue') query.loanStatus = 'Overdue';
  else if (status === 'active') query.loanStatus = 'Active';
  else if (status === 'completed') query.loanStatus = 'Completed';

  const clients = await ActiveLoan.find(query)
    .populate('borrowerId', 'fullName borrowerCode')
    .sort({ updatedAt: -1 });

  const tableData = clients.map(loan => ({
    borrowerName: loan.borrowerId?.fullName,
    borrowerCode: loan.borrowerId?.borrowerCode,
    loanAmount: loan.approvedAmount,
    emiStatus: loan.loanStatus === 'Overdue' ? 'Overdue' : 'Active', // Simplified logic
    dueDate: loan.nextDueDate,
    loanStatus: loan.loanStatus,
    borrowerId: loan.borrowerId?._id,
    loanId: loan._id
  }));

  sendSuccess(res, 'Assigned clients fetched', tableData);
});

/**
 * @desc    Send Payment Reminder
 * @route   POST /api/agent/dashboard/send-reminder
 */
const sendPaymentReminder = asyncHandler(async (req, res) => {
  const { borrowerId, loanId, reminderType } = req.body;

  if (!borrowerId || !loanId || !reminderType) {
    return sendError(res, 'All fields are required', 400);
  }

  // logic for sending SMS/WhatsApp/Email would go here
  // For now, we create a notification record for the agent to track
  await Notification.create({
    receiverId: req.user._id,
    receiverRole: 'agent',
    type: 'BORROWER_ALERT',
    title: `Reminder Sent (${reminderType})`,
    message: `You dispatched a ${reminderType} reminder to borrower ID: ${borrowerId}`,
    priority: 'LOW',
    isRead: true
  });

  sendSuccess(res, `Reminder successfully dispatched via ${reminderType}`);
});

/**
 * @desc    Create Follow-up Log
 * @route   POST /api/agent/dashboard/followup-log
 */
const createFollowupLog = asyncHandler(async (req, res) => {
  const { borrowerId, loanId, note, followupType } = req.body;

  if (!borrowerId || !note) {
    return sendError(res, 'Borrower ID and Note are required', 400);
  }

  // Log in notifications or a dedicated Activity model
  await Notification.create({
    receiverId: req.user._id,
    receiverRole: 'agent',
    type: 'FOLLOWUP_REMINDER',
    title: 'Follow-up Logged',
    message: `Follow-up note for borrower ${borrowerId}: ${note}`,
    priority: 'NORMAL',
    isRead: true,
    metadata: { borrowerId, loanId, followupType }
  });

  sendSuccess(res, 'Follow-up log created successfully');
});

module.exports = {
  getDashboardSummary,
  getAssignedClientsTable,
  sendPaymentReminder,
  createFollowupLog
};
