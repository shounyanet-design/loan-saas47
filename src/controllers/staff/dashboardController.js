const LoanApplication = require('../../models/LoanApplication');
const Payment = require('../../models/Payment');
const Notification = require('../../models/Notification');
const Borrower = require('../../models/Borrower');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/responseHandler');

/**
 * @desc    Get staff dashboard dynamic analytics and workflow data
 * @route   GET /api/staff/dashboard
 * @access  Private/Staff
 */
exports.getDashboardData = asyncHandler(async (req, res) => {
  const staffId = req.user._id;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. ANALYTICS CARDS
  
  // Pending Applications - Include all that need staff attention
  const pendingApplicationsCount = await LoanApplication.countDocuments({
    status: { $in: ['New', 'Submitted', 'Pending Review', 'Under Review', 'Pending Verification', 'Pending'] }
  });

  // Pending Verifications
  const pendingVerificationsCount = await Payment.countDocuments({
    paymentStatus: 'Pending'
  });

  // Reviewed Today by logged-in staff
  const reviewedTodayCount = await LoanApplication.countDocuments({
    'staffReview.reviewedBy': staffId,
    'staffReview.verificationDate': { $gte: today },
    status: { $in: ['Reviewed', 'Recommended', 'Approved', 'Rejected'] }
  });

  // Recent Activities count
  const recentActivitiesCount = await LoanApplication.countDocuments({
    updatedAt: { $gte: today }
  }) + await Payment.countDocuments({
    updatedAt: { $gte: today }
  });

  // 2. WORKFLOW QUEUE (Prioritized operational pipeline for pending applications)
  const pendingStatuses = [
    'New', 'Submitted', 'Under Review', 'Pending Review', 'Pending Verification', 
    'Pending', 'AGREEMENT_PENDING_VERIFICATION', 'DOCUMENTS_SUBMITTED', 'Draft'
  ];

  const workflowQueue = await LoanApplication.find({
    status: { $in: pendingStatuses }
  })
  .sort({ updatedAt: -1, createdAt: -1 })
  .limit(15)
  .populate('borrowerId', 'phoneNumber email profilePhoto');

  const formattedQueue = workflowQueue.map(app => ({
    applicationId: app._id,
    borrowerId: app.borrowerId?._id,
    borrowerName: app.fullName || app.borrowerName || 'Applicant',
    borrowerPhone: app.borrowerId?.phoneNumber || app.phoneNumber || 'N/A',
    loanId: app.applicationId || `APP-${String(app._id).slice(-6).toUpperCase()}`,
    loanType: app.loanType || 'Personal Loan',
    loanAmount: app.requestedAmount || app.loanAmount || 0,
    currentStatus: app.status || 'Pending Review',
    assignedDate: app.assignedAt || app.updatedAt || app.createdAt
  }));

  // 2.5 VERIFICATIONS QUEUE (Payments pending verification)
  const assignedBorrowerIds = await Borrower.find({ assignedStaff: staffId }).distinct('_id');

  const pendingPayments = await Payment.find({
    $or: [
      { borrowerId: { $in: assignedBorrowerIds } },
      { verifiedBy: staffId },
      { verifiedBy: null },
      { verifiedBy: { $exists: false } }
    ],
    paymentStatus: 'Pending',
    isDeleted: { $ne: true }
  })
  .sort({ paymentDate: -1, createdAt: -1 })
  .limit(15);

  const verificationsQueue = pendingPayments.map(pay => ({
    id: pay._id,
    borrowerId: pay.borrowerId,
    borrowerName: pay.borrowerName || 'Borrower',
    type: pay.paymentType || 'EMI Payment',
    status: pay.paymentStatus || 'Pending',
    date: pay.paymentDate || pay.createdAt,
    amount: pay.paymentAmount || 0,
    transactionId: pay.transactionId || `TRX-${String(pay._id).slice(-6).toUpperCase()}`
  }));

  // 3. PRIORITY ALERTS (Urgent operational alerts from Notification model)
  const priorityAlerts = await Notification.find({
    receiverId: staffId,
    isRead: false
  })
  .sort({ priority: 1, createdAt: -1 }) // Urgent first
  .limit(5);

  const formattedAlerts = priorityAlerts.map(alert => ({
    id: alert._id,
    alertType: alert.notificationType,
    title: alert.title,
    message: alert.message,
    createdAt: alert.createdAt,
    priority: alert.priority || 'normal'
  }));

  // 4. RECENT ACTIVITIES LIST
  // Fetching both applications reviewed and payments verified
  const recentApps = await LoanApplication.find({
    'staffReview.reviewedBy': staffId,
    status: { $nin: ['New', 'Under Review'] }
  })
  .sort({ updatedAt: -1 })
  .limit(5);

  const recentPayments = await Payment.find({
    verifiedBy: staffId
  })
  .sort({ updatedAt: -1 })
  .limit(5);

  const recentActivities = [
    ...recentApps.map(app => ({
      type: 'application',
      title: 'Application Reviewed',
      description: `Reviewed ${app.applicationId} for ${app.fullName}`,
      time: app.updatedAt,
      status: app.status
    })),
    ...recentPayments.map(pay => ({
      type: 'payment',
      title: 'Payment Verified',
      description: `Verified ${pay.transactionId} for ${pay.borrowerName}`,
      time: pay.updatedAt,
      status: pay.paymentStatus
    }))
  ].sort((a, b) => b.time - a.time).slice(0, 8);

  sendSuccess(res, 'Staff dashboard data retrieved', {
    analytics: {
      pendingApplications: pendingApplicationsCount,
      pendingVerifications: pendingVerificationsCount,
      reviewedToday: reviewedTodayCount,
      recentActivities: recentActivitiesCount
    },
    workflowQueue: formattedQueue,
    verificationsQueue: verificationsQueue,
    priorityAlerts: formattedAlerts,
    recentActivities: recentActivities,
    quickActionCounts: {
      reviewQueue: pendingApplicationsCount,
      verificationQueue: pendingVerificationsCount,
      urgentAlerts: priorityAlerts.filter(a => a.priority === 'urgent').length
    }
  });
});
