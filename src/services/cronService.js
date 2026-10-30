const cron = require('node-cron');
const RepaymentSchedule = require('../models/RepaymentSchedule');
const Notification = require('../models/Notification');
const LoanActivity = require('../models/LoanActivity');
const ActiveLoan = require('../models/ActiveLoan');
const Borrower = require('../models/Borrower');
const BorrowerAlert = require('../models/BorrowerAlert');
const Tenant = require('../models/Tenant');
const { createNotification } = require('../utils/notificationHelper');
const { getIO } = require('../socket/socketServer');
const tenantContext = require('../tenancy/tenantContext');
const SystemSettings = require('../models/SystemSettings');

/**
 * Utility to diagnose why populate returned null for a schedule reference
 */
const diagnoseMissingReference = async (emi) => {
  let loanStatus = 'Resolved';
  let borrowerStatus = 'Resolved';

  const rawLoanId = emi._doc?.loanId || emi.loanId;
  const rawBorrowerId = emi._doc?.borrowerId || emi.borrowerId;

  if (!emi.loanId && rawLoanId) {
    const rawLoan = await tenantContext.runAsSystem(() => ActiveLoan.findById(rawLoanId).lean());
    if (!rawLoan) {
      loanStatus = 'Hard-deleted document';
    } else if (rawLoan.isDeleted) {
      loanStatus = 'Soft-deleted document';
    } else {
      loanStatus = `Tenant mismatch (Loan tenant: ${rawLoan.tenantId})`;
    }
  }

  if (!emi.borrowerId && rawBorrowerId) {
    const rawBorrower = await tenantContext.runAsSystem(() => Borrower.findById(rawBorrowerId).lean());
    if (!rawBorrower) {
      borrowerStatus = 'Hard-deleted document';
    } else {
      borrowerStatus = `Tenant mismatch (Borrower tenant: ${rawBorrower.tenantId})`;
    }
  }

  return `[Loan: ${loanStatus}, Borrower: ${borrowerStatus}]`;
};

/**
 * Initialize all cron jobs
 *
 * Runs across ALL active and trialing tenants so each tenant's loans and borrowers
 * are processed inside their respective isolated tenantContext.
 */
const initCronJobs = () => {
  // Run every day at 00:00 (Midnight)
  cron.schedule('0 0 * * *', async () => {
    console.log('Running Multi-Tenant EMI Reminder Cron Job...');
    try {
      const activeTenants = await tenantContext.runAsSystem(() =>
        Tenant.find({ status: { $in: ['active', 'trialing'] } }).lean()
      );

      if (!activeTenants || activeTenants.length === 0) {
        // Fallback: check for default tenant
        const defaultTenant = await tenantContext.runAsSystem(() => Tenant.findOne({ isDefault: true }).lean());
        if (defaultTenant) {
          activeTenants.push(defaultTenant);
        }
      }

      const collectionWorker = require('../modules/loanCollection/collectionWorker');
      await collectionWorker.runDailyCollectionJob();

      for (const tenant of activeTenants) {
        try {
          await tenantContext.runWithTenant(tenant._id, async () => {
            await checkUpcomingEMIs();
            await checkOverdueEMIs();
            await checkGracePeriodReminders();
          });
        } catch (tenantErr) {
          console.error(`[Cron] Error processing EMIs for tenant ${tenant._id} (${tenant.name}):`, tenantErr.message);
        }
      }
    } catch (err) {
      console.error('[Cron] Failed to execute multi-tenant EMI reminder job:', err.message);
    }
  });

  // Run Debi24 automated collection and payment settlement sync twice daily (06:00 and 18:00)
  cron.schedule('0 6,18 * * *', async () => {
    console.log('[Cron] Running scheduled Debi24 collection and settlement sync...');
    try {
      const { syncAllActiveCollections, syncAllPaymentSettlements } = require('./debi24SyncService');
      const collectionsSummary = await syncAllActiveCollections();
      const settlementsSummary = await syncAllPaymentSettlements();
      console.log(`[Cron] Debi24 sync completed: ${collectionsSummary.updatedCount} collections updated, ${settlementsSummary.updatedCount} settlements updated.`);
    } catch (err) {
      console.error('[Cron] Failed to run scheduled Debi24 collection/settlement sync:', err.message);
    }
  });
};

/**
 * Check for EMIs due in 2 days and notify borrowers
 */
const checkUpcomingEMIs = async () => {
  try {
    const twoDaysFromNow = new Date();
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
    twoDaysFromNow.setHours(0, 0, 0, 0);

    const endOfTwoDaysFromNow = new Date(twoDaysFromNow);
    endOfTwoDaysFromNow.setHours(23, 59, 59, 999);

    const upcomingEmis = await RepaymentSchedule.find({
      status: 'Pending',
      dueDate: { $gte: twoDaysFromNow, $lte: endOfTwoDaysFromNow }
    }).populate('loanId borrowerId');

    const io = getIO();

    for (const emi of upcomingEmis) {
      if (!emi.loanId || !emi.borrowerId || emi.loanId.isDeleted) {
        const diag = await diagnoseMissingReference(emi);
        console.warn(`[Cron] Repayment schedule ${emi._id} references missing or soft-deleted loan/borrower ${diag}. Skipping financial mutation.`);
        continue;
      }

      const borrower = emi.borrowerId;
      const loan = emi.loanId;
      const borrowerUserId = borrower.userId ? borrower.userId.toString() : null;

      const message = `Your EMI payment of R ${emi.amount.toLocaleString()} is due on ${new Date(emi.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;

      // 1. Create Notification if borrower has an associated user account
      if (borrower.userId) {
        await createNotification({
          receiverId: borrower.userId,
          receiverRole: 'borrower',
          type: 'DUE_REMINDER',
          title: 'Upcoming EMI Reminder',
          message: message,
          priority: 'IMPORTANT',
          metadata: {
            loanId: loan._id,
            emiNumber: emi.emiNumber,
            amount: emi.amount
          }
        });
      }

      // 1b. Create BorrowerAlert
      await BorrowerAlert.create({
        borrowerId: borrower._id,
        title: 'Upcoming EMI Reminder',
        message: message,
        alertType: 'EMI_DUE',
        priority: 'Medium'
      });

      // 2. Emit Socket.IO event
      if (io && borrowerUserId) {
        io.to(borrowerUserId).emit('emi-due-alert', {
          title: 'Upcoming EMI Reminder',
          message: message,
          loanId: loan._id,
          dueDate: emi.dueDate
        });
        io.to(borrowerUserId).emit('dashboard-updated');
      }

      // 3. Log Activity
      await LoanActivity.create({
        loanId: loan._id,
        borrowerId: borrower._id,
        title: 'Upcoming EMI Reminder Sent',
        message: message,
        type: 'Notification'
      });
    }
    
    console.log(`EMI Reminder: Processed ${upcomingEmis.length} upcoming payments.`);
  } catch (error) {
    console.error('Error in Upcoming EMI Cron:', error);
  }
};

/**
 * Check for EMIs that became overdue today
 */
const checkOverdueEMIs = async () => {
  try {
    const settings = await SystemSettings.findOne().lean();
    const allowGracePeriod = settings?.allowGracePeriod !== false;
    const gracePeriodDays = Number(settings?.gracePeriodDays ?? 3);
    const autoApplyLateFee = settings?.autoApplyLateFee !== false;
    const configuredPenalty = Number(settings?.latePaymentPenalty ?? settings?.lateFeeAmount ?? 150);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdueEmis = await RepaymentSchedule.find({
      status: 'Pending',
      dueDate: { $lt: today }
    }).populate('loanId borrowerId');

    const io = getIO();

    for (const emi of overdueEmis) {
      if (!emi.loanId || !emi.borrowerId || emi.loanId.isDeleted) {
        const diag = await diagnoseMissingReference(emi);
        console.warn(`[Cron] Overdue repayment schedule ${emi._id} references missing or soft-deleted loan/borrower ${diag}. Skipping financial mutation.`);
        continue;
      }

      const borrower = emi.borrowerId;
      const loan = emi.loanId;
      const borrowerUserId = borrower.userId ? borrower.userId.toString() : null;

      // Atomically claim and update status to Overdue
      const updatedSchedule = await RepaymentSchedule.findOneAndUpdate(
        { _id: emi._id, status: 'Pending' },
        { $set: { status: 'Overdue' } },
        { new: true }
      );
      if (!updatedSchedule) {
        // Already processed or updated concurrently by another worker
        continue;
      }

      // Update ActiveLoan status to Overdue if it was Active
      if (loan.loanStatus === 'Active') {
        await ActiveLoan.findOneAndUpdate(
          { _id: loan._id, loanStatus: 'Active' },
          { $set: { loanStatus: 'Overdue' } }
        );
      }

      const message = `Urgent: Your EMI # ${emi.emiNumber} of R ${emi.amount.toLocaleString()} is OVERDUE since ${new Date(emi.dueDate).toLocaleDateString()}.`;

      // 1. Create Notification if borrower has an associated user account
      if (borrower.userId) {
        await createNotification({
          receiverId: borrower.userId,
          receiverRole: 'borrower',
          type: 'OVERDUE_WARNING',
          title: 'EMI Overdue Alert',
          message: message,
          priority: 'URGENT',
          metadata: {
            loanId: loan._id,
            emiNumber: emi.emiNumber
          }
        });
      }

      // 1b. Create BorrowerAlert
      await BorrowerAlert.create({
        borrowerId: borrower._id,
        title: 'EMI Overdue Alert',
        message: message,
        alertType: 'OVERDUE',
        priority: 'High'
      });

      // 2. Emit Socket.IO event
      if (io && borrowerUserId) {
        io.to(borrowerUserId).emit('overdue-alert', {
          title: 'EMI Overdue Alert',
          message: message,
          loanId: loan._id
        });
        io.to(borrowerUserId).emit('dashboard-updated');
      }

      // 3. Log Activity
      await LoanActivity.create({
        loanId: loan._id,
        borrowerId: borrower._id,
        title: 'EMI Marked Overdue',
        message: message,
        type: 'Penalty'
      });
    }

    // Automated Late Fee Runs: Trigger penalty run automatically at midnight after grace period expiration
    if (autoApplyLateFee) {
      const eligibleForPenalty = await RepaymentSchedule.find({
        status: 'Overdue',
        penaltyWaived: { $ne: true },
        $or: [
          { penaltyAmount: { $exists: false } },
          { penaltyAmount: 0 }
        ],
        dueDate: { $lt: today }
      }).populate('loanId borrowerId');

      for (const sched of eligibleForPenalty) {
        if (!sched.loanId || !sched.borrowerId || sched.loanId.isDeleted) continue;
        const diffTime = today.getTime() - new Date(sched.dueDate).getTime();
        const overdueDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        const graceExpired = !allowGracePeriod || (overdueDays > gracePeriodDays);

        if (graceExpired) {
          sched.penaltyAmount = configuredPenalty;
          await sched.save();
          await LoanActivity.create({
            loanId: sched.loanId._id,
            borrowerId: sched.borrowerId._id,
            title: 'Automated Late Fee Run',
            message: `Automated midnight penalty of R ${configuredPenalty} applied following grace period expiration (${overdueDays} days overdue).`,
            type: 'Penalty'
          });
        }
      }
    }
    
    console.log(`Overdue Check: Processed ${overdueEmis.length} overdue payments.`);
  } catch (error) {
    console.error('Error in Overdue EMI Cron:', error);
  }
};

/**
 * Check for EMIs whose grace period expires in 24 hours and notify borrowers
 * Governed by SystemSettings.allowGracePeriod and SystemSettings.graceReminders
 */
const checkGracePeriodReminders = async () => {
  try {
    const settings = await SystemSettings.findOne().lean();
    const allowGracePeriod = settings?.allowGracePeriod !== false;
    const graceReminders = settings?.graceReminders !== false;
    const gracePeriodDays = Number(settings?.gracePeriodDays ?? 3);
    const configuredPenalty = Number(settings?.latePaymentPenalty ?? settings?.lateFeeAmount ?? 150);

    // If grace period or grace reminders are disabled, skip
    if (!allowGracePeriod || !graceReminders || gracePeriodDays <= 0) {
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 24 hours prior to grace period expiration means overdueDays equals (gracePeriodDays - 1)
    const targetOverdueDays = gracePeriodDays - 1;

    const schedules = await RepaymentSchedule.find({
      status: { $in: ['Pending', 'Overdue'] },
      graceReminderSent: { $ne: true },
      dueDate: { $lt: today }
    }).populate('loanId borrowerId');

    const io = getIO();

    for (const emi of schedules) {
      if (!emi.loanId || !emi.borrowerId || emi.loanId.isDeleted) continue;

      const diffTime = today.getTime() - new Date(emi.dueDate).getTime();
      const overdueDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (overdueDays === targetOverdueDays) {
        const borrower = emi.borrowerId;
        const loan = emi.loanId;
        const borrowerUserId = borrower.userId ? borrower.userId.toString() : null;
        const dueAmount = emi.debitOrderCollectionAmount || emi.amount;

        const warningMsg = `Urgent Grace Warning: Your payment grace window for EMI #${emi.emiNumber} (R ${dueAmount.toLocaleString()}) expires in 24 hours. A late fee penalty of R ${configuredPenalty} will be added if unpaid.`;

        if (borrowerUserId) {
          await createNotification({
            receiverId: borrower.userId,
            receiverRole: 'borrower',
            type: 'GRACE_PERIOD_EXPIRING',
            title: 'Grace Period Expiring in 24 Hours',
            message: warningMsg,
            priority: 'URGENT',
            metadata: {
              loanId: loan._id,
              emiNumber: emi.emiNumber,
              penaltyAmount: configuredPenalty
            }
          });
        }

        await BorrowerAlert.create({
          borrowerId: borrower._id,
          title: 'Grace Period Expiring in 24 Hours',
          message: warningMsg,
          alertType: 'GRACE_PERIOD_EXPIRING',
          priority: 'Urgent'
        });

        if (io && borrowerUserId) {
          io.to(borrowerUserId).emit('grace-expiring-alert', {
            title: 'Grace Period Expiring in 24 Hours',
            message: warningMsg,
            loanId: loan._id
          });
          io.to(borrowerUserId).emit('dashboard-updated');
        }

        await LoanActivity.create({
          loanId: loan._id,
          borrowerId: borrower._id,
          title: 'Grace Period Expiration Warning Sent',
          message: warningMsg,
          type: 'Notification'
        });

        emi.graceReminderSent = true;
        await emi.save();
      }
    }
  } catch (err) {
    console.error('Error in Grace Period Reminder Cron:', err);
  }
};

module.exports = { initCronJobs, checkUpcomingEMIs, checkOverdueEMIs, checkGracePeriodReminders };
