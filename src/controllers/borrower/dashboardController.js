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
  // 1. Identify Borrower (support both Borrower profile _id and User _id)
  const userId = req.user._id;
  const borrower = await Borrower.findOne({ userId });
  const borrowerIds = borrower && borrower._id.toString() !== userId.toString()
    ? [borrower._id, userId]
    : [borrower ? borrower._id : userId];

  // Fetch unread alerts & recent activities regardless of loan lookup so dashboard cards stay accurate
  const [activeLoan, alerts, activities] = await Promise.all([
    // 2. Fetch Active Loan (matches either Borrower._id or legacy/disbursed User._id records)
    ActiveLoan.findOne({
      borrowerId: { $in: borrowerIds },
      loanStatus: { $in: ['Active', 'Overdue'] },
      isDeleted: false
    }).sort({ createdAt: -1 }),
    BorrowerAlert.find({
      borrowerId: { $in: borrowerIds },
      isRead: false
    }).sort({ createdAt: -1 }).limit(5),
    LoanActivity.find({
      borrowerId: { $in: borrowerIds }
    }).sort({ createdAt: -1 }).limit(10)
  ]);

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
    alerts,
    recentActivities: activities,
    loanSummary: null
  };

  if (activeLoan) {
    // 3. Find Next EMI (fallback to embedded schedule if RepaymentSchedule collection isn't populated yet)
    let nextEmi = await RepaymentSchedule.findOne({
      loanId: activeLoan._id,
      status: { $in: ['Pending', 'Overdue', 'Partial'] }
    }).sort({ dueDate: 1 });

    if (!nextEmi && Array.isArray(activeLoan.repaymentSchedule) && activeLoan.repaymentSchedule.length > 0) {
      const pendingEmis = activeLoan.repaymentSchedule
        .filter(emi => ['Pending', 'Overdue', 'Partial'].includes(emi.paymentStatus))
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
      if (pendingEmis.length > 0) {
        const emi = pendingEmis[0];
        nextEmi = {
          amount: emi.emiAmount,
          dueDate: emi.dueDate,
          emiNumber: emi.installmentNumber,
          status: emi.paymentStatus
        };
      }
    }

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

    // 5. Calculate Repayment Progress (clamped to 0..100 against total payable obligation)
    const totalPayable = activeLoan.totalPayableAmount || activeLoan.approvedAmount || 0;
    const totalPaid = Math.max(0, totalPayable - (activeLoan.remainingBalance || 0));
    const progress = totalPayable > 0
      ? Math.max(0, Math.min(100, Math.round((totalPaid / totalPayable) * 100)))
      : 0;

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
