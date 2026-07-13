const cron = require('node-cron');
const RepaymentSchedule = require('../models/RepaymentSchedule');
const Notification = require('../models/Notification');
const LoanActivity = require('../models/LoanActivity');
const Borrower = require('../models/Borrower');
const BorrowerAlert = require('../models/BorrowerAlert');
const Tenant = require('../models/Tenant');
const { createNotification } = require('../utils/notificationHelper');
const { getIO } = require('../socket/socketServer');
const tenantContext = require('../tenancy/tenantContext');

/**
 * Initialize all cron jobs
 *
 * MILESTONE 1 SCOPE: this background job runs inside the DEFAULT tenant's
 * context so its reads are correctly scoped and the records it creates
 * (notifications / alerts / activities) are stamped with the right tenantId.
 * When multiple tenants exist (later milestone), this should iterate over all
 * active tenants and run the checks once per tenant.
 */
const initCronJobs = () => {
  // Run every day at 00:00 (Midnight)
  cron.schedule('0 0 * * *', async () => {
    console.log('Running EMI Reminder Cron Job...');
    const defaultTenant = await tenantContext.runAsSystem(() =>
      Tenant.findOne({ isDefault: true })
    );
    if (!defaultTenant) {
      console.error('[Cron] No default tenant found — skipping EMI reminder job.');
      return;
    }
    await tenantContext.runWithTenant(defaultTenant._id, async () => {
      await checkUpcomingEMIs();
      await checkOverdueEMIs();
    });
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
      const borrower = await Borrower.findById(emi.borrowerId);
      if (!borrower) continue;

      const message = `Your EMI payment of R ${emi.amount.toLocaleString()} is due on ${new Date(emi.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;

      // 1. Create Notification
      await createNotification({
        receiverId: borrower.userId,
        receiverRole: 'borrower',
        type: 'DUE_REMINDER',
        title: 'Upcoming EMI Reminder',
        message: message,
        priority: 'IMPORTANT',
        metadata: {
          loanId: emi.loanId._id,
          emiNumber: emi.emiNumber,
          amount: emi.amount
        }
      });

      // 1b. Create BorrowerAlert
      await BorrowerAlert.create({
        borrowerId: borrower._id,
        title: 'Upcoming EMI Reminder',
        message: message,
        alertType: 'EMI_DUE',
        priority: 'Medium'
      });

      // 2. Emit Socket.IO event
      if (io) {
        io.to(borrower.userId.toString()).emit('emi-due-alert', {
          title: 'Upcoming EMI Reminder',
          message: message,
          loanId: emi.loanId._id,
          dueDate: emi.dueDate
        });
        io.to(borrower.userId.toString()).emit('dashboard-updated');
      }

      // 3. Log Activity
      await LoanActivity.create({
        loanId: emi.loanId._id,
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

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);

    const overdueEmis = await RepaymentSchedule.find({
      status: 'Pending',
      dueDate: { $lt: today }
    }).populate('loanId borrowerId');

    const io = getIO();

    for (const emi of overdueEmis) {
      const borrower = await Borrower.findById(emi.borrowerId);
      if (!borrower) continue;

      // Update status to Overdue
      emi.status = 'Overdue';
      await emi.save();

      // Update Loan status to Overdue if it was Active
      if (emi.loanId.loanStatus === 'Active') {
        emi.loanId.loanStatus = 'Overdue';
        await emi.loanId.save();
      }

      const message = `Urgent: Your EMI # ${emi.emiNumber} of R ${emi.amount.toLocaleString()} is OVERDUE since ${new Date(emi.dueDate).toLocaleDateString()}.`;

      // 1. Create Notification
      await createNotification({
        receiverId: borrower.userId,
        receiverRole: 'borrower',
        type: 'OVERDUE_WARNING',
        title: 'EMI Overdue Alert',
        message: message,
        priority: 'URGENT',
        metadata: {
          loanId: emi.loanId._id,
          emiNumber: emi.emiNumber
        }
      });

      // 1b. Create BorrowerAlert
      await BorrowerAlert.create({
        borrowerId: borrower._id,
        title: 'EMI Overdue Alert',
        message: message,
        alertType: 'OVERDUE',
        priority: 'High'
      });

      // 2. Emit Socket.IO event
      if (io) {
        io.to(borrower.userId.toString()).emit('overdue-alert', {
          title: 'EMI Overdue Alert',
          message: message,
          loanId: emi.loanId._id
        });
        io.to(borrower.userId.toString()).emit('dashboard-updated');
      }

      // 3. Log Activity
      await LoanActivity.create({
        loanId: emi.loanId._id,
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
