const asyncHandler = require('express-async-handler');
const Report = require('../../models/Report');
const Payment = require('../../models/Payment');
const ActiveLoan = require('../../models/ActiveLoan');
const DuePayment = require('../../models/DuePayment');
const User = require('../../models/User');
const { sendSuccess, sendError } = require('../../utils/responseHandler');

/**
 * @desc    Get dashboard stats
 * @route   GET /api/admin/reports/stats
 * @access  Private/Admin
 */
const getReportStats = asyncHandler(async (req, res) => {
  const collectionsAgg = await Payment.aggregate([
    { $match: { isDeleted: false, paymentStatus: 'Verified' } },
    { $group: { _id: null, total: { $sum: '$paymentAmount' } } }
  ]);
  const totalCollections = collectionsAgg.length > 0 ? collectionsAgg[0].total : 0;

  const totalLoans = await ActiveLoan.countDocuments({ isDeleted: false });
  const activeBorrowers = await User.countDocuments({ role: 'borrower', status: 'Active', isDeleted: false });
  const overduePayments = await DuePayment.countDocuments({ dueStatus: 'Overdue', isDeleted: false });
  
  // Agent commissions mock or aggregate if needed. Here we mock a value or calculate based on collections (e.g. 2%).
  const agentCommissions = totalCollections * 0.02;

  sendSuccess(res, 'Report stats fetched', {
    totalCollections,
    totalLoans,
    activeBorrowers,
    overduePayments,
    agentCommissions
  });
});

/**
 * @desc    Get collections overview (monthly)
 * @route   GET /api/admin/reports/collections-overview
 * @access  Private/Admin
 */
const getCollectionsOverview = asyncHandler(async (req, res) => {
  const currentYear = new Date().getFullYear();
  
  const payments = await Payment.aggregate([
    {
      $match: {
        isDeleted: false,
        paymentStatus: 'Verified',
        paymentDate: {
          $gte: new Date(`${currentYear}-01-01`),
          $lte: new Date(`${currentYear}-12-31`)
        }
      }
    },
    {
      $group: {
        _id: { month: { $month: '$paymentDate' } },
        collections: { $sum: '$paymentAmount' }
      }
    }
  ]);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const data = monthNames.map((name, index) => {
    const monthData = payments.find(p => p._id.month === index + 1);
    const collections = monthData ? monthData.collections : 0;
    const repayments = monthData ? monthData.collections : 0; // Keeping them matched if no specific logic exists for expected vs actual
    return {
      name,
      collections,
      repayments
    };
  });

  sendSuccess(res, 'Collections overview fetched', { data });
});

/**
 * @desc    Get loan performance
 * @route   GET /api/admin/reports/loan-performance
 * @access  Private/Admin
 */
const getLoanPerformance = asyncHandler(async (req, res) => {
  const stats = await ActiveLoan.aggregate([
    { $match: { isDeleted: false } },
    { $group: { _id: '$loanStatus', count: { $sum: 1 } } }
  ]);

  const result = {
    approved: 0,
    active: 0,
    completed: 0,
    overdue: 0
  };

  stats.forEach(s => {
    if (s._id === 'Active') result.active = s.count;
    else if (s._id === 'Completed') result.completed = s.count;
    else if (s._id === 'Overdue') result.overdue = s.count;
  });
  
  // Example for approved if tracked differently, else use active sum
  result.approved = result.active + result.completed + result.overdue;

  sendSuccess(res, 'Loan performance fetched', result);
});

/**
 * @desc    Get borrower overview
 * @route   GET /api/admin/reports/borrower-overview
 * @access  Private/Admin
 */
const getBorrowerOverview = asyncHandler(async (req, res) => {
  const stats = await User.aggregate([
    { $match: { role: 'borrower', isDeleted: false } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);

  const result = {
    active: 0,
    new: 0, // Mock or define logic
    overdue: 0, // Computed from DuePayment
    blacklisted: 0
  };

  stats.forEach(s => {
    if (s._id === 'Active') result.active = s.count;
    if (s._id === 'Blacklisted') result.blacklisted = s.count;
  });

  result.overdue = await DuePayment.distinct('borrowerId', { dueStatus: 'Overdue', isDeleted: false }).then(res => res.length);
  result.new = await User.countDocuments({ role: 'borrower', isDeleted: false, createdAt: { $gte: new Date(Date.now() - 30*24*60*60*1000) } });

  sendSuccess(res, 'Borrower overview fetched', result);
});

/**
 * @desc    Get all reports
 * @route   GET /api/admin/reports
 * @access  Private/Admin
 */
const getAllReports = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = '', category, format } = req.query;
  const query = { isDeleted: false };

  if (search) {
    query.$or = [
      { reportTitle: { $regex: search, $options: 'i' } },
      { reportCode: { $regex: search, $options: 'i' } }
    ];
  }

  if (category && category !== 'All Categories') query.reportCategory = category;
  if (format && format !== 'Export Format') query.exportFormat = format;

  const skip = (page - 1) * limit;

  const reports = await Report.find(query)
    .populate('generatedBy', 'firstName lastName')
    .sort({ generatedDate: -1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await Report.countDocuments(query);

  sendSuccess(res, 'Reports fetched successfully', {
    reports,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) }
  });
});

/**
 * @desc    Get single report
 * @route   GET /api/admin/reports/:id
 * @access  Private/Admin
 */
const getSingleReport = asyncHandler(async (req, res) => {
  const report = await Report.findOne({ _id: req.params.id, isDeleted: false }).populate('generatedBy', 'firstName lastName');
  if (!report) return sendError(res, 'Report not found', 404);
  sendSuccess(res, 'Report fetched successfully', { report });
});

/**
 * @desc    Generate report
 * @route   POST /api/admin/reports/generate
 * @access  Private/Admin
 */
const generateReport = asyncHandler(async (req, res) => {
  const { reportType, reportCategory, dateRange, exportFormat } = req.body;

  const count = await Report.countDocuments();
  const reportCode = `REP-${String(count + 1).padStart(4, '0')}`;

  const report = new Report({
    reportTitle: `${reportCategory} - ${reportType}`,
    reportCode,
    reportCategory,
    reportType,
    generatedBy: req.user._id,
    generatedDate: new Date(),
    exportFormat: exportFormat || 'PDF',
    dateRange,
    reportSummary: `This is an auto-generated ${reportCategory} focusing on ${reportType} within ${dateRange}.`,
    totalCollections: await Payment.aggregate([{ $match: { paymentStatus: 'Verified', isDeleted: false } }, { $group: { _id: null, total: { $sum: '$paymentAmount' } } }]).then(r => r[0]?.total || 0),
    totalLoans: await ActiveLoan.countDocuments({ isDeleted: false }),
    activeBorrowers: await User.countDocuments({ role: 'borrower', status: 'Active', isDeleted: false }),
    overduePayments: await DuePayment.countDocuments({ dueStatus: 'Overdue', isDeleted: false }),
    commissions: 0 // Will remain 0 until formal agent commission table is attached
  });

  await report.save();

  // Populate generator name for the response
  await report.populate('generatedBy', 'firstName lastName');

  sendSuccess(res, 'Report generated successfully', { report });
});

/**
 * @desc    Export report
 * @route   POST /api/admin/reports/:id/export
 * @access  Private/Admin
 */
const exportReport = asyncHandler(async (req, res) => {
  const { exportFormat } = req.body;
  const report = await Report.findOne({ _id: req.params.id, isDeleted: false });
  if (!report) return sendError(res, 'Report not found', 404);

  if (exportFormat) {
    report.exportFormat = exportFormat;
    await report.save();
  }

  // Generate data placeholder for export (In real app, this generates the buffer/URL)
  sendSuccess(res, 'Report exported successfully', { report });
});

/**
 * @desc    Delete report
 * @route   DELETE /api/admin/reports/:id
 * @access  Private/Admin
 */
const deleteReport = asyncHandler(async (req, res) => {
  const report = await Report.findOneAndUpdate({ _id: req.params.id, isDeleted: false }, { isDeleted: true });
  if (!report) return sendError(res, 'Report not found', 404);

  sendSuccess(res, 'Report deleted successfully');
});

module.exports = {
  getReportStats,
  getCollectionsOverview,
  getLoanPerformance,
  getBorrowerOverview,
  getAllReports,
  getSingleReport,
  generateReport,
  exportReport,
  deleteReport
};
