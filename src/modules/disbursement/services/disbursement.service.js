// src/modules/disbursement/services/disbursement.service.js
/**
 * Disbursement Service
 * Handles the actual loan disbursement workflow.
 * Validates tenant, application status, creates ActiveLoan, repayment schedule, updates LoanApplication, logs audit.
 */

const mongoose = require('mongoose');
const LoanApplication = require('../../../models/LoanApplication');
const ActiveLoan = require('../../../models/ActiveLoan');
const RepaymentSchedule = require('../../../models/RepaymentSchedule');
const PlatformAuditLog = require('../../platform/models/PlatformAuditLog'); // Use existing audit model

/**
 * Disburse a loan application.
 * @param {String} applicationId - LoanApplication._id as string
 * @param {Object} context - { tenantId, userId }
 * @returns {Object} { existing: Boolean, activeLoan: Object }
 */
async function disburseLoan(applicationId, context) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Load application scoped to tenant
    const application = await LoanApplication.findOne({ _id: applicationId, tenantId: context.tenantId }).session(session);
    if (!application) throw new Error('Loan application not found for tenant');

    // Must be READY_FOR_DISBURSEMENT and agreement signed, DebiCheck accepted
    if (application.disbursementStatus !== 'READY_FOR_DISBURSEMENT') {
      throw new Error('Application not ready for disbursement');
    }
    const agreementSigned = application.agreementStatus && application.agreementStatus.toUpperCase() === 'SIGNED';
    const debiAccepted = application.debicheckMandateStatus === 'ACCEPTED';
    if (!agreementSigned || !debiAccepted) {
      throw new Error('Pre-disbursement gates not satisfied');
    }

    // Ensure idempotency – if ActiveLoan already exists, return it
    let activeLoan = await ActiveLoan.findOne({ tenantId: context.tenantId, loanApplicationId: application._id }).session(session);
    if (activeLoan) {
      await session.commitTransaction();
      session.endSession();
      return { existing: true, activeLoan };
    }

    // Compute EMI schedule (reuse same logic as agreement signing)
    const loanAmount = application.approvedAmount || application.requestedAmount;
    const duration = application.adminDecision?.finalDuration || application.requestedDuration;
    const rate = application.interestRate || application.adminDecision?.interestOverride || 0;
    const monthlyRate = rate / 12 / 100;
    const emiAmount = Math.round((loanAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -duration)));
    const emiSchedule = [];
    let remainingBal = loanAmount;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() + 1);
    for (let i = 1; i <= duration; i++) {
      const interest = Math.round(remainingBal * monthlyRate);
      const principal = emiAmount - interest;
      remainingBal -= principal;
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i - 1);
      emiSchedule.push({
        installmentNumber: i,
        dueDate,
        emiAmount,
        principalAmount: principal,
        interestAmount: interest,
        paymentStatus: 'Pending'
      });
    }

    // Create ActiveLoan
    activeLoan = await ActiveLoan.create([
      {
        tenantId: context.tenantId,
        borrowerId: application.borrowerId,
        borrowerName: application.fullName,
        borrowerEmail: application.emailAddress,
        borrowerPhone: application.phoneNumber,
        loanApplicationId: application._id,
        loanCode: `P47-${Date.now()}`,
        loanType: application.loanType,
        approvedAmount: loanAmount,
        interestRate: rate,
        loanDurationMonths: duration,
        emiAmount,
        totalPayableAmount: emiAmount * duration,
        remainingBalance: emiAmount * duration,
        nextDueDate: emiSchedule[0].dueDate,
        repaymentSchedule: emiSchedule,
        disbursementStatus: 'DISBURSED',
        agreementCreditProviderSnapshot: application.agreementCreditProviderSnapshot,
        agreementSignedAt: application.agreementSignedAt || new Date(),
        agreementStatus: 'SIGNED',
        disbursementReady: true
      }
    ], { session })[0];

    // Populate RepaymentSchedule collection for reporting
    const repaymentEntries = emiSchedule.map(e => ({
      loanId: activeLoan._id,
      borrowerId: application.borrowerId,
      emiNumber: e.installmentNumber,
      dueDate: e.dueDate,
      amount: e.emiAmount,
      status: 'Pending'
    }));
    await RepaymentSchedule.insertMany(repaymentEntries, { session });

    // Update LoanApplication status fields
    application.status = 'DISBURSED';
    application.disbursementStatus = 'DISBURSED';
    application.disbursedAt = new Date();
    application.activeLoanId = activeLoan._id;
    await application.save({ session });

    // Audit log
    await PlatformAuditLog.create([
      {
        tenantId: context.tenantId,
        userId: context.userId,
        action: 'LOAN_DISBURSED',
        entity: 'LoanApplication',
        entityId: application._id,
        description: `Loan disbursed, ActiveLoan ${activeLoan._id} created`,
        createdAt: new Date()
      }
    ], { session });

    await session.commitTransaction();
    session.endSession();
    return { existing: false, activeLoan };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

module.exports = { disburseLoan };

