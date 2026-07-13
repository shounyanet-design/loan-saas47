const Borrower = require('../../models/Borrower');
const ActiveLoan = require('../../models/ActiveLoan');
const RepaymentSchedule = require('../../models/RepaymentSchedule');
const BorrowerAlert = require('../../models/BorrowerAlert');
const LoanActivity = require('../../models/LoanActivity');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');

/**
 * @desc    Get Borrower Dashboard Data
 * @route   GET /api/borrower/dashboard
 * @access  Private/Borrower
 */
const getBorrowerDashboard = asyncHandler(async (req, res) => {
  // 1. Identify Borrower
  const borrower = await Borrower.findOne({ userId: req.user._id });
  
  // Default empty state
  let dashboardData = {
    loanOverview: null,
    nextEmi: null,
    remainingBalance: {
      amount: 0,
      currency: 'ZAR'
    },
    loanStatus: 'No Active Loan',
    repaymentProgress: 0,
    alerts: [],
    recentActivities: [],
    loanSummary: null
  };

  if (!borrower) {
    return sendSuccess(res, 'Dashboard data loaded successfully (Profile missing)', dashboardData);
  }

  // 2. Fetch Active Loan
  const activeLoan = await ActiveLoan.findOne({ 
    borrowerId: borrower._id,
    loanStatus: { $in: ['Active', 'Overdue'] }
  }).sort({ createdAt: -1 });

  if (activeLoan) {
    // 3. Find Next EMI
    const nextEmi = await RepaymentSchedule.findOne({
      loanId: activeLoan._id,
      status: { $in: ['Pending', 'Overdue', 'Partial'] }
    }).sort({ dueDate: 1 });

    // 4. Calculate Days Left
    let daysLeft = 0;
    if (nextEmi) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDate = new Date(nextEmi.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      const diffTime = dueDate - today;
      daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    // 5. Calculate Repayment Progress
    const totalPaid = (activeLoan.approvedAmount - activeLoan.remainingBalance) || 0;
    const progress = Math.min(100, Math.round((totalPaid / activeLoan.approvedAmount) * 100));

    // 6. Fetch Alerts
    const alerts = await BorrowerAlert.find({ 
      borrowerId: borrower._id,
      isRead: false 
    }).sort({ createdAt: -1 }).limit(5);

    // 7. Fetch Recent Activities
    const activities = await LoanActivity.find({ 
      borrowerId: borrower._id 
    }).sort({ createdAt: -1 }).limit(10);

    dashboardData = {
      loanOverview: {
        loanCode: activeLoan.loanCode,
        approvedAmount: activeLoan.approvedAmount,
        totalPayable: activeLoan.totalPayableAmount,
        loanType: activeLoan.loanType,
        interestRate: activeLoan.interestRate
      },
      nextEmi: nextEmi ? {
        amount: nextEmi.amount,
        dueDate: nextEmi.dueDate,
        daysLeft: daysLeft,
        emiNumber: nextEmi.emiNumber,
        status: nextEmi.status
      } : null,
      remainingBalance: {
        amount: activeLoan.remainingBalance,
        currency: 'ZAR'
      },
      loanStatus: activeLoan.loanStatus,
      repaymentProgress: progress,
      alerts: alerts,
      recentActivities: activities,
      loanSummary: {
        approvedAmount: activeLoan.approvedAmount,
        remainingBalance: activeLoan.remainingBalance,
        interestRate: activeLoan.interestRate,
        nextEmiDate: nextEmi ? nextEmi.dueDate : null,
        repaymentProgress: progress,
        loanDuration: activeLoan.loanDurationMonths,
        emiAmount: activeLoan.emiAmount
      }
    };
  }

  sendSuccess(res, 'Dashboard data loaded successfully', dashboardData);
});

module.exports = {
  getBorrowerDashboard
};
