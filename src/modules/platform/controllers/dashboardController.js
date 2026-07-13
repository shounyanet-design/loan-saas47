const mongoose = require('mongoose');
const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess } = require('../../../utils/responseHandler');

const Tenant = require('../../../models/Tenant');
const User = require('../../../models/User');
const Borrower = require('../../../models/Borrower');
const Staff = require('../../../models/Staff');
const Loan = require('../../../models/Loan');
const ActiveLoan = require('../../../models/ActiveLoan');
const LoanApplication = require('../../../models/LoanApplication');
const PlatformAuditLog = require('../models/PlatformAuditLog');

// All queries here run inside SYSTEM mode (set by protectPlatform), so the
// tenant plugin returns cross-tenant (platform-wide) data.

// @route GET /api/platform/dashboard
exports.getDashboard = asyncHandler(async (req, res) => {
  const [
    totalTenants, activeTenants, trialTenants, pendingTenants, suspendedTenants, expiredTenants, disabledTenants,
    totalBorrowers, totalStaff, totalUsers, totalLoans, totalActiveLoans, totalApplications,
    recentTenants, recentActivities,
  ] = await Promise.all([
    Tenant.countDocuments({}),
    Tenant.countDocuments({ status: 'active' }),
    Tenant.countDocuments({ status: 'trial' }),
    Tenant.countDocuments({ status: 'pending' }),
    Tenant.countDocuments({ status: 'suspended' }),
    Tenant.countDocuments({ status: 'expired' }),
    Tenant.countDocuments({ status: 'disabled' }),
    Borrower.countDocuments({}),
    Staff.countDocuments({}),
    User.countDocuments({}),
    Loan.countDocuments({}),
    ActiveLoan.countDocuments({}),
    LoanApplication.countDocuments({}),
    Tenant.find({}).sort({ createdAt: -1 }).limit(5).select('companyName companyCode status createdAt owner email').lean(),
    PlatformAuditLog.find({}).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  const systemHealth = {
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptimeSeconds: Math.round(process.uptime()),
    nodeEnv: process.env.NODE_ENV || 'development',
    timestamp: new Date(),
  };

  return sendSuccess(res, 'Dashboard data', {
    tenants: {
      total: totalTenants,
      active: activeTenants,
      trial: trialTenants,
      pending: pendingTenants,
      suspended: suspendedTenants,
      expired: expiredTenants,
      disabled: disabledTenants,
    },
    totals: {
      borrowers: totalBorrowers,
      staff: totalStaff,
      users: totalUsers,
      loans: totalLoans,
      activeLoans: totalActiveLoans,
      applications: totalApplications,
      // Not yet instrumented (a usage-metering milestone will populate these).
      apiRequests: 0,
      storageUsedMb: 0,
    },
    recentTenants,
    recentActivities,
    systemHealth,
  });
});

// @route GET /api/platform/analytics
// Time-series style aggregates for charts.
exports.getAnalytics = asyncHandler(async (req, res) => {
  const tenantsByStatus = await Tenant.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $project: { _id: 0, status: '$_id', count: 1 } },
  ]);

  // Tenant registrations per month (last 12 months).
  const tenantGrowth = await Tenant.aggregate([
    { $group: { _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } }, count: { $sum: 1 } } },
    { $sort: { '_id.y': 1, '_id.m': 1 } },
    { $project: { _id: 0, year: '$_id.y', month: '$_id.m', count: 1 } },
  ]);

  const loansByStatus = await Loan.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $project: { _id: 0, status: '$_id', count: 1 } },
  ]);

  return sendSuccess(res, 'Platform analytics', { tenantsByStatus, tenantGrowth, loansByStatus });
});
