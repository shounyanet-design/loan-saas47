const Commission = require('../../models/Commission');
const Borrower = require('../../models/Borrower');
const ActiveLoan = require('../../models/ActiveLoan');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');

/**
 * @desc    Get agent earnings dashboard data
 * @route   GET /api/agent/earnings/dashboard
 * @access  Private/Agent
 */
exports.getEarningsDashboard = asyncHandler(async (req, res) => {
  const agentId = req.user._id;

  // 1. Analytics Cards
  const allCommissions = await Commission.find({ agentId, isDeleted: false });

  const totalEarnings = allCommissions.reduce((acc, curr) => acc + curr.commissionAmount, 0);
  const paidCommission = allCommissions
    .filter(c => c.status === 'Paid')
    .reduce((acc, curr) => acc + curr.commissionAmount, 0);
  const unpaidCommission = totalEarnings - paidCommission;

  // Monthly Commission (Current Month)
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthlyCommission = allCommissions
    .filter(c => c.createdAt >= startOfMonth)
    .reduce((acc, curr) => acc + curr.commissionAmount, 0);

  // 2. Chart Data (Last 6 Months)
  const chartData = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const monthName = d.toLocaleString('default', { month: 'short' });
    const mStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

    const monthComms = allCommissions.filter(c => c.createdAt >= mStart && c.createdAt <= mEnd);
    const paid = monthComms.filter(c => c.status === 'Paid').reduce((acc, curr) => acc + curr.commissionAmount, 0);
    const unpaid = monthComms.filter(c => c.status !== 'Paid').reduce((acc, curr) => acc + curr.commissionAmount, 0);

    chartData.push({
      month: monthName,
      paid,
      unpaid
    });
  }

  // 3. Summary Panel
  const activeCommissions = allCommissions.filter(c => c.status === 'Pending').length;
  const pendingPayouts = allCommissions.filter(c => c.status === 'Processing').length;
  const completedPayouts = allCommissions.filter(c => c.status === 'Paid').length;

  sendSuccess(res, 'Earnings dashboard data retrieved', {
    agentName: req.user.fullName,
    analytics: {
      monthlyCommission,
      totalEarnings,
      paidCommission,
      unpaidCommission
    },
    summary: {
      activeCommissions,
      thisMonthEarnings: monthlyCommission,
      pendingPayouts,
      completedPayouts
    },
    chartData
  });
});

/**
 * @desc    Get all commission entries with filters
 * @route   GET /api/agent/earnings
 * @access  Private/Agent
 */
exports.getEarningsTable = asyncHandler(async (req, res) => {
  const agentId = req.user._id;
  const { page = 1, limit = 10, search = '', status = '', startDate, endDate } = req.query;

  const query = { agentId, isDeleted: false };

  if (status && status !== 'All Statuses') {
    query.status = status;
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const commissions = await Commission.find(query)
    .populate('borrowerId', 'fullName profilePhoto')
    .populate('loanId', 'loanCode loanType approvedAmount')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const total = await Commission.countDocuments(query);

  const formattedCommissions = commissions.map(c => ({
    commissionId: c._id,
    commissionCode: c.commissionCode,
    borrowerId: c.borrowerId?._id,
    borrowerName: c.borrowerId?.fullName || 'N/A',
    borrowerPhoto: c.borrowerId?.profilePhoto,
    loanId: c.loanId?.loanCode || 'N/A',
    loanType: c.loanId?.loanType || 'N/A',
    loanAmount: c.loanAmount,
    commissionPercent: c.commissionPercent,
    commissionAmount: c.commissionAmount,
    paymentStatus: c.status,
    paymentDate: c.payoutDate,
    generatedAt: c.createdAt
  }));

  sendSuccess(res, 'Commission table data retrieved', {
    commissions: formattedCommissions,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit)
    }
  });
});

/**
 * @desc    Get single earning detail
 * @route   GET /api/agent/earnings/:commissionId
 * @access  Private/Agent
 */
exports.getEarningDetails = asyncHandler(async (req, res) => {
  const { commissionId } = req.params;
  const agentId = req.user._id;

  const commission = await Commission.findOne({ _id: commissionId, agentId })
    .populate('borrowerId', 'fullName email phoneNumber')
    .populate({
      path: 'loanId',
      select: 'loanCode loanType approvedAmount loanDurationMonths approvedDate'
    });

  if (!commission) {
    return sendError(res, 'Commission record not found', 404);
  }

  sendSuccess(res, 'Commission details retrieved', {
    borrower: {
      fullName: commission.borrowerId?.fullName,
      phone: commission.borrowerId?.phoneNumber,
      email: commission.borrowerId?.email
    },
    loan: {
      loanCode: commission.loanId?.loanCode,
      loanAmount: commission.loanAmount,
      loanType: commission.loanId?.loanType,
      loanDuration: commission.loanId?.loanDurationMonths,
      approvalDate: commission.loanId?.approvedDate
    },
    commission: {
      commissionCode: commission.commissionCode,
      commissionPercent: commission.commissionPercent,
      earnedAmount: commission.commissionAmount,
      payoutStatus: commission.status,
      payoutDate: commission.payoutDate,
      generatedDate: commission.createdAt
    }
  });
});

/**
 * @desc    Export earnings (Mock - returns filtered data for frontend to handle or CSV string)
 * @route   POST /api/agent/earnings/export
 * @access  Private/Agent
 */
exports.exportEarnings = asyncHandler(async (req, res) => {
  const agentId = req.user._id;
  const { format, startDate, endDate, paymentStatus } = req.body;

  const query = { agentId, isDeleted: false };
  if (paymentStatus && paymentStatus !== 'All Statuses') query.status = paymentStatus;
  
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const commissions = await Commission.find(query)
    .populate('borrowerId', 'fullName')
    .populate('loanId', 'loanCode loanType')
    .sort({ createdAt: -1 });

  const formattedData = commissions.map(c => ({
    commissionCode: c.commissionCode,
    borrowerName: c.borrowerId?.fullName || 'N/A',
    loanCode: c.loanId?.loanCode || 'N/A',
    loanType: c.loanId?.loanType || 'N/A',
    loanAmount: c.loanAmount,
    commissionAmount: c.commissionAmount,
    status: c.status,
    payoutDate: c.payoutDate,
    createdAt: c.createdAt
  }));

  sendSuccess(res, `Earnings data fetched for ${format} export`, {
    commissions: formattedData
  });
});

/**
 * @desc    Download monthly statement
 * @route   POST /api/agent/earnings/statement
 * @access  Private/Agent
 */
exports.downloadStatement = asyncHandler(async (req, res) => {
  const agentId = req.user._id;
  const { month, year, format } = req.body;

  // Convert month name to number
  const monthMap = {
    January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
    July: 6, August: 7, September: 8, October: 9, November: 10, December: 11
  };
  const monthNum = monthMap[month];
  
  const startOfMonth = new Date(year, monthNum, 1);
  const endOfMonth = new Date(year, monthNum + 1, 0, 23, 59, 59);

  const commissions = await Commission.find({
    agentId,
    isDeleted: false,
    createdAt: { $gte: startOfMonth, $lte: endOfMonth }
  })
  .populate('borrowerId', 'fullName')
  .populate('loanId', 'loanCode loanType');

  const formattedData = commissions.map(c => ({
    commissionCode: c.commissionCode,
    borrowerName: c.borrowerId?.fullName || 'N/A',
    loanCode: c.loanId?.loanCode || 'N/A',
    loanAmount: c.loanAmount,
    commissionAmount: c.commissionAmount,
    status: c.status,
    date: c.createdAt
  }));

  sendSuccess(res, `Statement data fetched for ${month} ${year}`, {
    commissions: formattedData,
    summary: {
      totalEarned: commissions.reduce((acc, curr) => acc + curr.commissionAmount, 0),
      totalPaid: commissions.filter(c => c.status === 'Paid').reduce((acc, curr) => acc + curr.commissionAmount, 0),
      count: commissions.length
    }
  });
});

/**
 * @desc    Get recent payouts
 * @route   GET /api/agent/earnings/recent-payouts
 * @access  Private/Agent
 */
exports.getRecentPayouts = asyncHandler(async (req, res) => {
  const agentId = req.user._id;

  const recentPaid = await Commission.find({ agentId, status: 'Paid', isDeleted: false })
    .populate('borrowerId', 'fullName')
    .sort({ payoutDate: -1 })
    .limit(5);

  const pendingPayouts = await Commission.find({ agentId, status: 'Processing', isDeleted: false })
    .populate('borrowerId', 'fullName')
    .sort({ createdAt: -1 })
    .limit(5);

  const recentApprovals = await Commission.find({ agentId, status: 'Pending', isDeleted: false })
    .populate('borrowerId', 'fullName')
    .sort({ createdAt: -1 })
    .limit(5);

  sendSuccess(res, 'Recent payouts retrieved', {
    recentPaid,
    pendingPayouts,
    recentApprovals
  });
});
