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

    // Resolve authoritative financial snapshot
    const { calculateLoanFinances, generateRepaymentSchedule } = require('../../../services/loanFinancialCalculator');
    let finSnap = (application.agreementFinancialSnapshot && application.agreementFinancialSnapshot.principalAmount)
      ? application.agreementFinancialSnapshot
      : (application.financialSnapshot && application.financialSnapshot.principalAmount ? application.financialSnapshot : null);

    if (!finSnap) {
      // Safe fallback for legacy records
      const SystemSettings = require('../../../models/SystemSettings');
      const settings = await SystemSettings.findOne().session(session);
      const activeProducts = settings?.loanProducts || [];
      const selectedProduct = activeProducts.find(p => p.name === application.loanType);

      finSnap = calculateLoanFinances({
        amount: application.approvedAmount || application.requestedAmount,
        duration: application.adminDecision?.finalDuration || application.requestedDuration,
        interestRate: application.interestRate || application.adminDecision?.interestOverride,
        interestType: selectedProduct?.interestType || 'Reducing Balance',
        settings,
        selectedProduct
      });
    }

    const loanAmount = finSnap.principalAmount;
    const duration = finSnap.durationMonths;
    const rate = finSnap.annualInterestRate;
    const totalRepaymentAmount = finSnap.totalRepaymentAmount;
    const totalPayableAmount = totalRepaymentAmount;
    const emiAmount = finSnap.monthlyInstallmentAmount;

    // Generate schedule with remainder absorption (guaranteed sum === totalPayableAmount)
    const emiSchedule = generateRepaymentSchedule({
      totalRepaymentAmount,
      durationMonths: duration,
      startDate: new Date()
    });

    let creditProviderSnapshot = (application.agreementCreditProviderSnapshot && application.agreementCreditProviderSnapshot.legalName)
      ? application.agreementCreditProviderSnapshot
      : null;

    if (!creditProviderSnapshot && context.tenantId) {
      const Tenant = require('../../../models/Tenant');
      const tenantContext = require('../../../tenancy/tenantContext');
      const tenant = await tenantContext.runAsSystem(() => Tenant.findById(context.tenantId).lean());
      if (tenant && tenant.companyProfile && tenant.companyProfile.legalName) {
        creditProviderSnapshot = {
          tenantId: context.tenantId,
          ...tenant.companyProfile,
          registeredAddress: tenant.companyProfile.registeredAddress || {},
          authorizedSignatory: tenant.companyProfile.authorizedSignatory || {}
        };
      }
    }

    // Create ActiveLoan
    activeLoan = (await ActiveLoan.create([
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
        totalPayableAmount,
        remainingBalance: totalPayableAmount,
        financialSnapshot: finSnap,
        agreementFinancialSnapshot: finSnap,
        nextDueDate: emiSchedule[0].dueDate,
        repaymentSchedule: emiSchedule,
        disbursementStatus: 'DISBURSED',
        agreementCreditProviderSnapshot: creditProviderSnapshot || application.agreementCreditProviderSnapshot,
        agreementSignedAt: application.agreementSignedAt || new Date(),
        agreementStatus: 'SIGNED',
        disbursementReady: true
      }
    ], { session }))[0];

    // Populate RepaymentSchedule collection for reporting & collection queries
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

