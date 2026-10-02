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
          });
        } catch (tenantErr) {
          console.error(`[Cron] Error processing EMIs for tenant ${tenant._id} (${tenant.name}):`, tenantErr.message);
        }
      }
    } catch (err) {
      console.error('[Cron] Failed to execute multi-tenant EMI reminder job:', err.message);
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
    
    console.log(`Overdue Check: Processed ${overdueEmis.length} overdue payments.`);
  } catch (error) {
    console.error('Error in Overdue EMI Cron:', error);
  }
};

module.exports = { initCronJobs };
