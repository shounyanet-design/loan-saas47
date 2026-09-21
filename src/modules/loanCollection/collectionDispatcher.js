const RepaymentSchedule = require('../../models/RepaymentSchedule');
const CollectionAttempt = require('../../models/CollectionAttempt');
const loanCollectionService = require('./loanCollectionService');

class CollectionDispatcher {
  /**
   * Dispatch primary NuPay collections for all due schedules within a tenant context.
   */
  async dispatchDueCollectionsForTenant(tenantId, targetDate = new Date()) {
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Find pending repayment schedules due on or before targetDate
    const dueSchedules = await RepaymentSchedule.find({
      tenantId,
      status: { $in: ['Pending', 'Overdue'] },
      dueDate: { $lte: endOfDay }
    });

    const results = [];

    for (const schedule of dueSchedules) {
      try {
        // Prevent duplicate submissions for the same schedule if active attempt exists
        const existingAttempt = await CollectionAttempt.findOne({
          tenantId,
          repaymentScheduleId: schedule._id,
          status: { $in: ['SUBMITTED', 'PROCESSING', 'TRACKING', 'SUCCESSFUL', 'SUCCESS'] }
        });

        if (existingAttempt) {
          results.push({
            repaymentScheduleId: schedule._id,
            status: 'SKIPPED',
            reason: 'ACTIVE_ATTEMPT_EXISTS',
            attemptId: existingAttempt._id
          });
          continue;
        }

        const res = await loanCollectionService.submitPrimaryCollection(schedule._id, tenantId);
        results.push({
          repaymentScheduleId: schedule._id,
          status: res.success ? 'DISPATCHED' : 'FAILED',
          result: res
        });
      } catch (err) {
        console.error(`[CollectionDispatcher] Error processing schedule ${schedule._id}:`, err.message);
        results.push({
          repaymentScheduleId: schedule._id,
          status: 'ERROR',
          error: err.message
        });
      }
    }

    return results;
  }
}

module.exports = new CollectionDispatcher();
