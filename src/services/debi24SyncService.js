const mongoose = require('mongoose');
const ActiveLoan = require('../models/ActiveLoan');
const LoanApplication = require('../models/LoanApplication');
const Payment = require('../models/Payment');
const Tenant = require('../models/Tenant');
const RepaymentSchedule = require('../models/RepaymentSchedule');
const LoanActivity = require('../models/LoanActivity');
const SystemSettings = require('../models/SystemSettings');
const tenantContext = require('../tenancy/tenantContext');
const debi24Service = require('./debi24Service');
const { allocateVerifiedPayment, reverseVerifiedPayment } = require('./paymentAllocationEngine');

const VALID_COLLECTION_STATUSES = [
  'Scheduled',
  'In Tracking',
  'Successful',
  'Failed',
  'Disputed',
  'Cancelled',
  'Recalled',
  'Unknown'
];

/**
 * Standardize Debi24/NuPay API statuses to ActiveLoan collectionStatus enum
 */
function normalizeDebi24Status(rawStatus) {
  if (!rawStatus) return 'Unknown';
  const s = String(rawStatus).trim().toUpperCase();

  // Paid / Successful / Settled
  if (['PAID', 'SUCCESSFUL', 'SETTLED', 'PROCESSED', 'SUCCESS'].includes(s)) {
    return 'Successful';
  }

  // Failed / Unpaid / Bounced / Insufficient Funds
  if (['FAILED', 'UNPAID', 'BOUNCED', 'REJECTED', 'INSUFFICIENT_FUNDS', 'RETURNED'].includes(s)) {
    return 'Failed';
  }

  // In Tracking / Pending / Submitted
  if (['IN_TRACKING', 'TRACKING', 'PENDING', 'SUBMITTED', 'QUEUED'].includes(s)) {
    return 'In Tracking';
  }

  // Disputed
  if (['DISPUTED', 'DISPUTE'].includes(s)) {
    return 'Disputed';
  }

  // Cancelled
  if (['CANCELLED', 'CANCELED'].includes(s)) {
    return 'Cancelled';
  }

  // Recalled
  if (['RECALLED', 'RECALL'].includes(s)) {
    return 'Recalled';
  }

  // Scheduled / Active / Accepted
  if (['SCHEDULED', 'ACTIVE', 'ACCEPTED'].includes(s)) {
    return 'Scheduled';
  }

  return 'Unknown';
}

/**
 * Resolve target downstream clientId for Debi24 multi-tenancy
 */
function resolveDebi24ClientId(tenant) {
  if (!tenant) return (process.env.DEBI24_CLIENT_ID || 'pointfortyseven').trim();
  if (tenant.debi24ClientId && String(tenant.debi24ClientId).trim()) {
    return String(tenant.debi24ClientId).trim();
  }
  if (tenant.isDefault) {
    return (process.env.DEBI24_CLIENT_ID || 'pointfortyseven').trim();
  }
  const rawName = String(tenant.companyName || tenant.companyCode || '').trim();
  if (rawName) {
    return rawName.replace(/\s+/g, '-');
  }
  return (process.env.DEBI24_CLIENT_ID || 'pointfortyseven').trim();
}

/**
 * Core financial mutation logic for debit order collection status changes.
 * Used identically by automated sync and manual admin override.
 */
async function applyCollectionStatusUpdate(activeLoan, {
  collectionStatus,
  reference,
  amount,
  date,
  userId,
  notes,
  session = null
} = {}) {
  if (!VALID_COLLECTION_STATUSES.includes(collectionStatus)) {
    const err = new Error(`Invalid collection status: ${collectionStatus}`);
    err.statusCode = 400;
    throw err;
  }

  const prevStatus = activeLoan.collectionStatus;
  activeLoan.collectionStatus = collectionStatus;
  activeLoan.lastCollectionDate = date ? new Date(date) : new Date();
  if (reference) {
    activeLoan.lastCollectionReference = reference;
  }

  let paymentAllocated = false;
  let paymentReversed = false;

  // Rule 1: Successful -> Create verified Debit Order payment and allocate across schedule
  if (collectionStatus === 'Successful' && prevStatus !== 'Successful') {
    const paymentAmount = Number(amount || activeLoan.emiAmount || 0);
    const settleRef = reference || `SETTLE-${Math.floor(100000 + Math.random() * 900000)}`;

    const existingPayment = await Payment.findOne({
      loanId: activeLoan._id,
      paymentMethod: 'Debit Order',
      settlementReference: settleRef,
      isDeleted: false
    }).session(session);

    if (!existingPayment && paymentAmount > 0) {
      const payment = new Payment({
        borrowerId: activeLoan.borrowerId,
        borrowerName: activeLoan.borrowerName,
        borrowerPhoto: activeLoan.borrowerPhoto,
        borrowerPhone: activeLoan.borrowerPhone,
        loanId: activeLoan._id,
        loanCode: activeLoan.loanCode,
        paymentAmount,
        paymentDate: date ? new Date(date) : new Date(),
        paymentMethod: 'Debit Order',
        paymentStatus: 'Verified',
        settlementStatus: 'Matched',
        settlementReference: settleRef,
        paymentType: 'EMI Payment',
        notes: notes || `Debi24 Collection Successful (Ref: ${settleRef})`,
        tenantId: activeLoan.tenantId
      });
      await payment.save({ session });

      await allocateVerifiedPayment(payment._id, userId || activeLoan.approvedBy, session);
      paymentAllocated = true;
    }
  }
  // Rule 2: Disputed -> Reverse latest verified debit order payment and restore schedule
  else if (collectionStatus === 'Disputed' && prevStatus !== 'Disputed') {
    const latestVerifiedDebitPayment = await Payment.findOne({
      loanId: activeLoan._id,
      paymentMethod: 'Debit Order',
      paymentStatus: 'Verified',
      isDeleted: false
    }).sort({ createdAt: -1 }).session(session);

    if (latestVerifiedDebitPayment) {
      await reverseVerifiedPayment(
        latestVerifiedDebitPayment._id,
        userId || activeLoan.approvedBy,
        notes || 'Debi24 Dispute - Debtor disputed debit order collection',
        session
      );
      paymentReversed = true;
    }
  }
  // Rule 3: Failed / Unpaid / Bounced -> Apply One-Time Flat Debit Order Retry Fee
  else if (['Failed', 'Unpaid', 'Bounced'].includes(collectionStatus)) {
    const schedQuery = {
      loanId: activeLoan._id,
      status: { $in: ['Pending', 'Overdue'] }
    };
    if (activeLoan.tenantId) {
      schedQuery.tenantId = activeLoan.tenantId;
    }

    const schedule = await RepaymentSchedule.findOne(schedQuery)
      .sort({ emiNumber: 1 })
      .session(session);

    if (schedule) {
      // Enforce client rule: One-time flat fee per failed monthly installment
      if (!schedule.retryFeeAmount || schedule.retryFeeAmount === 0) {
        const settings = await SystemSettings.findOne().lean();
        const retryFee = Number(settings?.debitOrderRetryFee ?? 50);

        schedule.retryFeeAmount = retryFee;
        schedule.debitOrderFailed = true;

        // Final amount to be collected on retry = Base + Service Fee + Retry Fee
        schedule.debitOrderCollectionAmount = 
          Number(schedule.baseEmiAmount || schedule.amount) + 
          Number(schedule.debi24ServiceFeeAmount || 0) + 
          Number(retryFee);

        await schedule.save({ session });

        // Update active loan total payable amount and remaining balance to include retry fee
        activeLoan.totalPayableAmount = Number(activeLoan.totalPayableAmount || 0) + retryFee;
        activeLoan.remainingBalance = Number(activeLoan.remainingBalance || 0) + retryFee;

        // Audit activity log
        await LoanActivity.create([{
          loanId: activeLoan._id,
          borrowerId: activeLoan.borrowerId,
          title: 'Debit Order Failed - Retry Fee Charged',
          message: `Debit order collection failed. One-time flat retry fee of R ${retryFee} applied to EMI #${schedule.emiNumber}. New collection amount: R ${schedule.debitOrderCollectionAmount}.`,
          type: 'Penalty',
          tenantId: activeLoan.tenantId
        }], { session });
      }
    }
  }

  await activeLoan.save({ session });

  return {
    activeLoan,
    prevStatus,
    newStatus: collectionStatus,
    paymentAllocated,
    paymentReversed
  };
}

/**
 * Synchronize Debi24 collection status for a single ActiveLoan
 */
async function syncLoanCollectionStatus(activeLoanOrId, actorId = null) {
  let activeLoan;
  if (typeof activeLoanOrId === 'string' || activeLoanOrId instanceof mongoose.Types.ObjectId) {
    activeLoan = await ActiveLoan.findById(activeLoanOrId);
  } else {
    activeLoan = activeLoanOrId;
  }

  if (!activeLoan) {
    throw new Error('Active loan not found');
  }

  // 1. Locate the associated LoanApplication to retrieve mandate reference
  let loanApp = null;
  if (activeLoan.loanApplicationId) {
    loanApp = await LoanApplication.findById(activeLoan.loanApplicationId).lean();
  }
  if (!loanApp && activeLoan.applicationId) {
    loanApp = await LoanApplication.findOne({ applicationId: activeLoan.applicationId }).lean();
  }

  const mandateRef =
    loanApp?.nupayMandate?.mandateId ||
    loanApp?.debicheckMandateReference ||
    loanApp?.nupayMandate?.contractReference ||
    activeLoan.lastCollectionReference;

  if (!mandateRef) {
    return {
      success: false,
      skipped: true,
      reason: 'No DebiCheck mandate associated with this loan',
      activeLoan
    };
  }

  // 2. Resolve client ID for multi-tenancy
  let debi24ClientId = loanApp?.nupayMandate?.debi24ClientId;
  if (!debi24ClientId && activeLoan.tenantId) {
    const tenant = await Tenant.findById(activeLoan.tenantId).lean();
    debi24ClientId = resolveDebi24ClientId(tenant);
  }
  debi24ClientId = debi24ClientId || (process.env.DEBI24_CLIENT_ID || 'pointfortyseven').trim();

  // 3. Resolve mandate UUID in Debi24 Bridge
  let mandateId = null;
  try {
    const { baseUrl, clientId, apiKey } = debi24Service.getConfig(debi24ClientId);
    mandateId = await debi24Service.resolveMandateId(mandateRef, baseUrl, clientId, apiKey);
  } catch (resErr) {
    console.warn(`[Debi24Sync] mandate ID resolution notice for loan ${activeLoan.loanCode}: ${resErr.message}`);
  }

  if (!mandateId) {
    return {
      success: true,
      skipped: true,
      reason: `Legacy or offline mandate reference (${mandateRef}) is not registered in Debi24`,
      mandateRef,
      activeLoan
    };
  }

  // 4. Request synchronization of collections from NuPay via Debi24 Bridge
  try {
    await debi24Service.syncMandateCollections(mandateId, debi24ClientId);
  } catch (syncErr) {
    console.warn(`[Debi24Sync] syncMandateCollections notice for loan ${activeLoan.loanCode} (mandate: ${mandateId}): ${syncErr.message}`);
  }

  // 5. Query live collections for the mandate
  let collectionsRes;
  try {
    collectionsRes = await debi24Service.getMandateCollections(mandateId, debi24ClientId);
  } catch (collErr) {
    return {
      success: false,
      skipped: true,
      reason: `Debi24 collections lookup failed: ${collErr.message}`,
      mandateId,
      activeLoan
    };
  }

  const collections = Array.isArray(collectionsRes)
    ? collectionsRes
    : (collectionsRes?.items || collectionsRes?.data || []);

  if (collections.length > 0) {
    // Sort collections by date descending (latest first)
    collections.sort((a, b) => {
      const dateA = new Date(a.actionDate || a.collectionDate || a.createdAt || 0).getTime();
      const dateB = new Date(b.actionDate || b.collectionDate || b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    const latest = collections[0];
    const normalizedStatus = normalizeDebi24Status(latest.status);
    const collectionAmount = Number(latest.amount || latest.instalmentAmount || activeLoan.emiAmount || 0);
    const collectionRef = latest.externalReference || latest.reference || latest.id || `COL-${mandateId.slice(-6)}`;
    const collectionDate = latest.actionDate || latest.collectionDate || latest.createdAt || new Date();

    const updateResult = await applyCollectionStatusUpdate(activeLoan, {
      collectionStatus: normalizedStatus,
      reference: collectionRef,
      amount: collectionAmount,
      date: collectionDate,
      userId: actorId,
      notes: `Automated Debi24 Sync: ${latest.status} (Reference: ${collectionRef})`
    });

    return {
      success: true,
      updated: true,
      activeLoan: updateResult.activeLoan,
      collectionStatus: normalizedStatus,
      previousStatus: updateResult.prevStatus,
      paymentAllocated: updateResult.paymentAllocated,
      paymentReversed: updateResult.paymentReversed,
      latestCollection: latest,
      mandateId
    };
  }

  // 6. If no collections exist yet, check mandate standing to confirm 'Scheduled' status
  let mandateInfo = null;
  try {
    mandateInfo = await debi24Service.getMandate(mandateId, debi24ClientId);
  } catch (mErr) {
    console.warn(`[Debi24Sync] getMandate lookup for loan ${activeLoan.loanCode}: ${mErr.message}`);
  }

  const rawMandateStatus = String(mandateInfo?.mandate?.status || mandateInfo?.status || '').toUpperCase();
  let fallbackStatus = activeLoan.collectionStatus || 'Scheduled';
  if (['ACTIVE', 'ACCEPTED', 'PENDING'].includes(rawMandateStatus)) {
    if (!activeLoan.collectionStatus || activeLoan.collectionStatus === 'Unknown') {
      fallbackStatus = 'Scheduled';
      await applyCollectionStatusUpdate(activeLoan, {
        collectionStatus: fallbackStatus,
        reference: mandateId,
        userId: actorId,
        notes: `Debi24 Sync: Mandate is ${rawMandateStatus}, awaiting collection strike date`
      });
    }
  }

  return {
    success: true,
    updated: false,
    activeLoan,
    collectionStatus: fallbackStatus,
    mandateStatus: rawMandateStatus || 'UNKNOWN',
    mandateId,
    message: 'Mandate is active, no collection executions reported by bank yet'
  };
}

/**
 * Synchronize all active and overdue loans across all tenants
 */
async function syncAllActiveCollections() {
  return await tenantContext.runAsSystem(async () => {
    const candidateLoans = await ActiveLoan.find({
      isDeleted: false,
      loanStatus: { $in: ['Active', 'Overdue'] }
    });

    console.log(`[Debi24Sync] Starting automated collections sync for ${candidateLoans.length} active/overdue loans...`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const loan of candidateLoans) {
      try {
        const result = await syncLoanCollectionStatus(loan);
        if (result.skipped) {
          skippedCount++;
        } else if (result.updated) {
          updatedCount++;
        }
      } catch (err) {
        errorCount++;
        errors.push({
          loanId: loan._id,
          loanCode: loan.loanCode,
          error: err.message
        });
        console.error(`[Debi24Sync] Failed to sync loan ${loan.loanCode}:`, err.message);
      }
    }

    const summary = {
      totalCandidates: candidateLoans.length,
      updatedCount,
      skippedCount,
      errorCount,
      errors: errors.slice(0, 10),
      timestamp: new Date().toISOString()
    };

    console.log(`[Debi24Sync] Sync complete: ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors.`);
    return summary;
  });
}

/**
 * Synchronize Debi24 settlement status for a single Payment
 */
async function syncPaymentSettlementStatus(paymentOrId, actorId = null) {
  let payment;
  if (typeof paymentOrId === 'string' || paymentOrId instanceof mongoose.Types.ObjectId) {
    payment = await Payment.findById(paymentOrId);
  } else {
    payment = paymentOrId;
  }

  if (!payment) {
    throw new Error('Payment record not found');
  }

  // Non-debit order payments do not use Debi24 settlement tracking
  if (payment.paymentMethod !== 'Debit Order') {
    if (payment.settlementStatus !== 'Not Applicable') {
      payment.settlementStatus = 'Not Applicable';
      await payment.save();
    }
    return {
      success: true,
      skipped: true,
      reason: 'Non-debit order payments are not processed via Debi24',
      settlementStatus: 'Not Applicable',
      payment
    };
  }

  // Find associated ActiveLoan & LoanApplication
  const activeLoan = await ActiveLoan.findById(payment.loanId);
  let loanApp = null;
  if (activeLoan?.loanApplicationId) {
    loanApp = await LoanApplication.findById(activeLoan.loanApplicationId).lean();
  }
  if (!loanApp && activeLoan?.applicationId) {
    loanApp = await LoanApplication.findOne({ applicationId: activeLoan.applicationId }).lean();
  }

  const mandateRef =
    loanApp?.nupayMandate?.mandateId ||
    loanApp?.debicheckMandateReference ||
    loanApp?.nupayMandate?.contractReference ||
    activeLoan?.lastCollectionReference;

  // Resolve downstream client ID
  let debi24ClientId = loanApp?.nupayMandate?.debi24ClientId;
  if (!debi24ClientId && payment.tenantId) {
    const tenant = await Tenant.findById(payment.tenantId).lean();
    debi24ClientId = resolveDebi24ClientId(tenant);
  }
  debi24ClientId = debi24ClientId || (process.env.DEBI24_CLIENT_ID || 'pointfortyseven').trim();

  // Resolve mandate UUID in Debi24 Bridge
  let mandateId = null;
  if (mandateRef) {
    try {
      const { baseUrl, clientId, apiKey } = debi24Service.getConfig(debi24ClientId);
      mandateId = await debi24Service.resolveMandateId(mandateRef, baseUrl, clientId, apiKey);
    } catch (resErr) {
      console.warn(`[Debi24Settlement] Mandate resolution notice for payment ${payment.transactionId}: ${resErr.message}`);
    }
  }

  if (!mandateId) {
    return {
      success: true,
      skipped: true,
      reason: `Legacy or offline mandate reference (${mandateRef || 'none'}) is not registered in Debi24`,
      settlementStatus: payment.settlementStatus || 'Pending',
      payment
    };
  }

  // Query live collections for the mandate
  let collectionsRes = null;
  try {
    collectionsRes = await debi24Service.getMandateCollections(mandateId, debi24ClientId);
  } catch (collErr) {
    console.warn(`[Debi24Settlement] Collections lookup notice for payment ${payment.transactionId}: ${collErr.message}`);
  }

  const collections = Array.isArray(collectionsRes)
    ? collectionsRes
    : (collectionsRes?.items || collectionsRes?.data || []);

  let matchedCollection = null;
  if (collections.length > 0) {
    matchedCollection = collections.find(c =>
      (payment.settlementReference && (c.reference === payment.settlementReference || c.externalReference === payment.settlementReference || c.id === payment.settlementReference)) ||
      (payment.transactionId && c.reference === payment.transactionId)
    ) || collections[0];
  }

  let newSettlementStatus = payment.settlementStatus || 'Pending';
  if (matchedCollection) {
    const rawStatus = String(matchedCollection.status || '').toUpperCase();
    if (['PAID', 'SETTLED', 'SUCCESSFUL', 'MATCHED', 'PROCESSED'].includes(rawStatus)) {
      newSettlementStatus = 'Matched';
      payment.settledDate = matchedCollection.actionDate || matchedCollection.collectionDate || new Date();
    } else if (['DISPUTED', 'DISPUTE'].includes(rawStatus)) {
      newSettlementStatus = 'Disputed';
    } else if (['REVERSED', 'RECALLED'].includes(rawStatus)) {
      newSettlementStatus = 'Reversed';
    } else if (['CANCELLED', 'CANCELED', 'FAILED', 'BOUNCED'].includes(rawStatus)) {
      newSettlementStatus = 'Cancelled';
    } else {
      newSettlementStatus = 'Pending';
    }

    if (matchedCollection.batchId || matchedCollection.settlementBatchId) {
      payment.settlementBatchId = matchedCollection.batchId || matchedCollection.settlementBatchId;
    }
  }

  payment.settlementStatus = newSettlementStatus;
  await payment.save();

  return {
    success: true,
    updated: true,
    payment,
    settlementStatus: newSettlementStatus,
    matchedCollection,
    mandateId
  };
}

/**
 * Synchronize settlements for all debit order payments across all tenants
 */
async function syncAllPaymentSettlements() {
  return await tenantContext.runAsSystem(async () => {
    const debitPayments = await Payment.find({
      isDeleted: false,
      paymentMethod: 'Debit Order'
    });

    console.log(`[Debi24Settlement] Starting automated settlement sync for ${debitPayments.length} debit order payments...`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const payment of debitPayments) {
      try {
        const res = await syncPaymentSettlementStatus(payment);
        if (res.skipped) {
          skippedCount++;
        } else if (res.updated) {
          updatedCount++;
        }
      } catch (err) {
        errorCount++;
        console.error(`[Debi24Settlement] Failed to sync payment ${payment.transactionId}:`, err.message);
      }
    }

    const summary = {
      totalCandidates: debitPayments.length,
      updatedCount,
      skippedCount,
      errorCount,
      timestamp: new Date().toISOString()
    };

    console.log(`[Debi24Settlement] Sync complete: ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors.`);
    return summary;
  });
}

module.exports = {
  VALID_COLLECTION_STATUSES,
  normalizeDebi24Status,
  resolveDebi24ClientId,
  applyCollectionStatusUpdate,
  syncLoanCollectionStatus,
  syncAllActiveCollections,
  syncPaymentSettlementStatus,
  syncAllPaymentSettlements
};
