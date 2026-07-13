const asyncHandler = require('express-async-handler');
const DuePayment = require('../../models/DuePayment');
const ActiveLoan = require('../../models/ActiveLoan');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { createNotification } = require('../../utils/notificationHelper');
const Borrower = require('../../models/Borrower');

/**
 * Utility function to sync Due Payments from ActiveLoans
 */
const syncDuePayments = async () => {
  const activeLoans = await ActiveLoan.find({ isDeleted: false, loanStatus: { $in: ['Active', 'Overdue'] } });
  
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  for (const loan of activeLoans) {
    let loanIsOverdue = false;
    let loanPenaltyAccumulated = 0;

    for (const inst of loan.repaymentSchedule) {
      if (inst.paymentStatus === 'Paid') {
        // Mark as paid in DuePayment if it exists
        await DuePayment.findOneAndUpdate(
          { loanId: loan._id, installmentNumber: inst.installmentNumber },
          { dueStatus: 'Paid' }
        );
        continue;
      }

      const dueDate = new Date(inst.dueDate);
      const dueDateStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
      
      const diffTime = todayStart.getTime() - dueDateStart.getTime();
      const overdueDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      
      if (overdueDays >= 0) {
        // Due today or Overdue
        let dueStatus = overdueDays === 0 ? 'Due Today' : 'Overdue';
        let lateDayStatus = 'On Time';
        let penaltyAmount = 0;
        
        if (overdueDays >= 1 && overdueDays <= 7) {
          lateDayStatus = '1-7 Days Late';
          penaltyAmount = 150; // Small penalty
        } else if (overdueDays > 7) {
          lateDayStatus = '8+ Days Late';
          penaltyAmount = 300; // Higher penalty
        }

        if (dueStatus === 'Overdue') {
          loanIsOverdue = true;
          inst.paymentStatus = 'Overdue';
        }
        
        loanPenaltyAccumulated += penaltyAmount;

        const totalDueAmount = inst.emiAmount + penaltyAmount;

        await DuePayment.findOneAndUpdate(
          { loanId: loan._id, installmentNumber: inst.installmentNumber },
          {
            $setOnInsert: {
              borrowerId: loan.borrowerId,
              borrowerName: loan.borrowerName,
              borrowerPhoto: loan.borrowerPhoto,
              borrowerPhone: loan.borrowerPhone,
              borrowerEmail: loan.borrowerEmail || 'Not Provided',
              borrowerAddress: 'Verified Address on File',
              loanCode: loan.loanCode,
              emiAmount: inst.emiAmount,
              dueDate: inst.dueDate,
              loanAmount: loan.approvedAmount,
            },
            $set: {
              remainingBalance: loan.remainingBalance,
              overdueDays,
              penaltyAmount,
              totalDueAmount,
              dueStatus,
              lateDayStatus,
              isDeleted: false
            }
          },
          { upsert: true }
        );

        // Trigger notification if newly overdue
        if (dueStatus === 'Overdue') {
          try {
            const borrower = await Borrower.findById(loan.borrowerId);
            if (borrower && borrower.assignedStaff) {
              await createNotification({
                receiverId: borrower.assignedStaff,
                receiverRole: 'staff',
                senderRole: 'system',
                notificationType: 'OverdueAlert',
                title: 'Loan Payment Overdue',
                message: `Payment for Loan ${loan.loanCode} (${borrower.fullName}) is now ${overdueDays} days overdue.`,
                relatedId: loan._id,
                relatedModel: 'ActiveLoan',
                priority: overdueDays > 7 ? 'urgent' : 'important'
              });
            }
          } catch (notifErr) {}
        }
      }
    }
    
    let needsSave = false;
    if (loanIsOverdue && loan.loanStatus !== 'Overdue') {
      loan.loanStatus = 'Overdue';
      loan.overdueStatus = 'Overdue';
      needsSave = true;
    }
    if (loan.penaltyAmount !== loanPenaltyAccumulated) {
      loan.penaltyAmount = loanPenaltyAccumulated;
      needsSave = true;
    }
    
    if (needsSave) {
      await loan.save();
    }
  }
};

/**
 * @desc    Get all due payments
 * @route   GET /api/admin/due-payments
 * @access  Private/Admin
 */
const getAllDuePayments = asyncHandler(async (req, res) => {
  await syncDuePayments();

  const { page = 1, limit = 10, search = '', status } = req.query;
  const query = { isDeleted: false, dueStatus: { $nin: ['Paid', 'Rescheduled', 'Cancelled', 'Recalled'] } };

  if (search) {
    query.$or = [
      { borrowerName: { $regex: search, $options: 'i' } },
      { loanCode: { $regex: search, $options: 'i' } },
      { borrowerPhone: { $regex: search, $options: 'i' } }
    ];
  }

  if (status && status !== 'All') {
    query.dueStatus = status;
  }

  const skip = (page - 1) * limit;

  const duePayments = await DuePayment.find(query)
    .sort({ overdueDays: -1, dueDate: 1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await DuePayment.countDocuments(query);

  sendSuccess(res, 'Due payments fetched successfully', {
    duePayments,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) }
  });
});

/**
 * @desc    Get specific due statuses
 * @route   GET /api/admin/due-payments/today (or overdue)
 * @access  Private/Admin
 */
const getDueTodayPayments = asyncHandler(async (req, res) => {
  await syncDuePayments();
  const duePayments = await DuePayment.find({ dueStatus: 'Due Today', isDeleted: false });
  sendSuccess(res, 'Due today payments fetched', { duePayments });
});

const getOverduePayments = asyncHandler(async (req, res) => {
  await syncDuePayments();
  const duePayments = await DuePayment.find({ dueStatus: 'Overdue', isDeleted: false }).sort({ overdueDays: -1 });
  sendSuccess(res, 'Overdue payments fetched', { duePayments });
});

/**
 * @desc    Get dashboard stats
 * @route   GET /api/admin/due-payments/stats
 * @access  Private/Admin
 */
const getDuePaymentStats = asyncHandler(async (req, res) => {
  await syncDuePayments();

  const dueTodayCount = await DuePayment.countDocuments({ dueStatus: 'Due Today', isDeleted: false });
  const overdueCount = await DuePayment.countDocuments({ dueStatus: 'Overdue', isDeleted: false });
  const lateEmiAccounts = await DuePayment.distinct('loanId', { dueStatus: 'Overdue', isDeleted: false });

  const aggregate = await DuePayment.aggregate([
    { $match: { isDeleted: false, dueStatus: { $nin: ['Paid', 'Rescheduled', 'Cancelled', 'Recalled'] } } },
    { $group: { _id: null, totalDue: { $sum: '$totalDueAmount' } } }
  ]);
  const totalDueAmount = aggregate.length > 0 ? aggregate[0].totalDue : 0;

  sendSuccess(res, 'Stats fetched successfully', {
    dueTodayCount,
    overdueCount,
    totalDueAmount,
    lateEmiAccounts: lateEmiAccounts.length
  });
});

/**
 * @desc    Get single due payment details
 * @route   GET /api/admin/due-payments/:id
 * @access  Private/Admin
 */
const getDuePaymentDetails = asyncHandler(async (req, res) => {
  const duePayment = await DuePayment.findOne({ _id: req.params.id, isDeleted: false });
  if (!duePayment) return sendError(res, 'Due payment not found', 404);
  sendSuccess(res, 'Details fetched successfully', { duePayment });
});

/**
 * @desc    Send single reminder
 * @route   POST /api/admin/due-payments/:id/send-reminder
 * @access  Private/Admin
 */
const sendReminder = asyncHandler(async (req, res) => {
  const duePayment = await DuePayment.findOne({ _id: req.params.id, isDeleted: false });
  if (!duePayment) return sendError(res, 'Due payment not found', 404);

  const senderName = req.user.firstName + ' ' + req.user.lastName;
  const message = `Reminder: Your EMI of R ${duePayment.totalDueAmount} for loan ${duePayment.loanCode} is ${duePayment.dueStatus}.`;

  duePayment.reminderHistory.push({
    date: new Date(),
    type: 'Email',
    status: 'Sent',
    senderName,
    message
  });

  duePayment.reminderStatus = 'Reminder Sent';
  duePayment.lastReminderDate = new Date();
  await duePayment.save();

  sendSuccess(res, 'Reminder sent successfully', { duePayment });
});

/**
 * @desc    Send bulk reminders
 * @route   POST /api/admin/due-payments/bulk-reminders
 * @access  Private/Admin
 */
const sendBulkReminders = asyncHandler(async (req, res) => {
  const { filter } = req.body; // 'Due Today', 'Overdue', or 'All'
  let query = { isDeleted: false, dueStatus: { $ne: 'Paid' } };

  if (filter === 'Due Today' || filter === 'Overdue') {
    query.dueStatus = filter;
  }

  const duePayments = await DuePayment.find(query);
  const senderName = req.user.firstName + ' ' + req.user.lastName;
  
  for (const dp of duePayments) {
    dp.reminderHistory.push({
      date: new Date(),
      type: 'Email',
      status: 'Sent',
      senderName,
      message: `Automated Reminder for ${dp.loanCode}`
    });
    dp.reminderStatus = 'Reminder Sent';
    dp.lastReminderDate = new Date();
    await dp.save();
  }

  sendSuccess(res, `Bulk reminders sent to ${duePayments.length} borrowers.`);
});

/**
 * @desc    Export due payments
 * @route   GET /api/admin/due-payments/export
 * @access  Private/Admin
 */
const exportDuePayments = asyncHandler(async (req, res) => {
  await syncDuePayments();
  const duePayments = await DuePayment.find({ isDeleted: false, dueStatus: { $nin: ['Paid', 'Rescheduled', 'Cancelled', 'Recalled'] } }).lean();
  sendSuccess(res, 'Export data ready', { duePayments });
});

/**
 * @desc    Update notes
 * @route   PUT /api/admin/due-payments/:id/notes
 * @access  Private/Admin
 */
const updateNotes = asyncHandler(async (req, res) => {
  const { notes } = req.body;
  const duePayment = await DuePayment.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { notes },
    { new: true }
  );

  if (!duePayment) return sendError(res, 'Due payment not found', 404);
  sendSuccess(res, 'Notes updated successfully', { duePayment });
});

module.exports = {
  getAllDuePayments,
  getDuePaymentStats,
  getDuePaymentDetails,
  getDueTodayPayments,
  getOverduePayments,
  sendReminder,
  sendBulkReminders,
  exportDuePayments,
  updateNotes
};
