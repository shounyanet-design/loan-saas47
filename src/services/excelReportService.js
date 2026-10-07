const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const ActiveLoan = require('../models/ActiveLoan');
const Payment = require('../models/Payment');
const LoanStatusHistory = require('../models/LoanStatusHistory');

/**
 * Format date as DD/MM/YYYY
 * @param {Date|string} dateVal
 * @returns {string}
 */
function formatDateDDMMYYYY(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Round to 2 decimal places safely
 * @param {number} num
 * @returns {number}
 */
function round2(num) {
  const n = Number(num);
  if (isNaN(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Detect application channel authoritatively from LoanStatusHistory records.
 * Rules:
 * - 'Loan application submitted by borrower (Full)' -> 'Online Applications'
 * - 'Loan application submitted on behalf of borrower by ...' -> 'Manually'
 * - Missing or indeterminate -> '' (blank; strictly no false fallback).
 *
 * @param {Array<Object>} historyEntries
 * @returns {string} 'Online Applications' | 'Manually' | ''
 */
function detectChannelFromHistory(historyEntries) {
  if (!Array.isArray(historyEntries) || historyEntries.length === 0) {
    return '';
  }

  // 1. Check earliest 'Submitted' entry first
  const submittedEntry = historyEntries.find(h => h.status === 'Submitted') || historyEntries[0];
  const primaryNotes = (submittedEntry.notes || '').toLowerCase();

  if (primaryNotes.includes('submitted on behalf of borrower') || primaryNotes.includes('on behalf')) {
    return 'Manually';
  }
  if (primaryNotes.includes('submitted by borrower') || primaryNotes.includes('by borrower')) {
    return 'Online Applications';
  }

  // 2. Scan remaining entries if not matched in the primary entry
  for (const entry of historyEntries) {
    const notes = (entry.notes || '').toLowerCase();
    if (notes.includes('submitted on behalf of borrower') || notes.includes('on behalf')) {
      return 'Manually';
    }
    if (notes.includes('submitted by borrower') || notes.includes('by borrower')) {
      return 'Online Applications';
    }
  }

  // Indeterminate: Return empty string (do NOT fabricate or assume Online Applications)
  return '';
}

/**
 * Resolve collection method label from existing system terminology.
 * Rules:
 * - DEBICHECK -> 'DebiCheck'
 * - MANUAL / other -> 'Manual'
 *
 * @param {string} rawMethod
 * @returns {string}
 */
function resolveCollectionMethodLabel(rawMethod) {
  if (!rawMethod) return 'DebiCheck';
  const m = String(rawMethod).trim().toUpperCase();
  if (m === 'DEBICHECK' || m === 'DEBIT ORDER') {
    return 'DebiCheck';
  }
  if (m === 'MANUAL' || m === 'PAYFAST_CARD' || m === 'CASH DEPOSIT' || m === 'EFT' || m === 'BANK TRANSFER') {
    return 'Manual';
  }
  return 'Manual';
}

/**
 * Resolve D/O Status string without initiating provider calls or mutating state.
 * @param {Object} loan
 * @returns {string}
 */
function resolveDebitOrderStatus(loan) {
  const profileAuth = loan.borrowerId?.collectionProfile?.authorizationStatus;
  if (profileAuth === 'ACTIVE') return 'Active';

  const mandateStatus = loan.loanApplicationId?.debicheckMandateStatus || loan.loanApplicationId?.nupayMandate?.outcome;
  if (mandateStatus === 'ACCEPTED' || mandateStatus === 'Active') return 'Active';
  if (mandateStatus === 'PENDING') return 'Pending';
  if (mandateStatus === 'REJECTED' || mandateStatus === 'FAILED') return 'Rejected';

  return 'Active'; // Standard active baseline for disbursed active loans
}

/**
 * Agreement Report Column Definitions (16 columns)
 * Excludes: Agreement / Agr No, Own Ref, Track (non-existent in system).
 */
const AGREEMENT_COLUMNS = [
  { header: 'Acc No', key: 'accNo', width: 14 },
  { header: 'Name', key: 'name', width: 24 },
  { header: 'Channel', key: 'channel', width: 20 },
  { header: 'Id Number', key: 'idNumber', width: 18 },
  { header: 'Created By', key: 'createdBy', width: 22 },
  { header: 'Terms', key: 'terms', width: 10 },
  { header: 'Product', key: 'product', width: 26 },
  { header: 'Created', key: 'created', width: 14 },
  { header: 'Deferred', key: 'deferred', width: 14 },
  { header: 'Capital', key: 'capital', width: 14 },
  { header: 'Intr', key: 'intr', width: 12 },
  { header: 'Ini', key: 'ini', width: 12 },
  { header: 'Adm', key: 'adm', width: 12 },
  { header: 'VAT', key: 'vat', width: 10 },
  { header: 'Payments', key: 'payments', width: 16 },
  { header: 'Balance', key: 'balance', width: 14 }
];

/**
 * Installment Report Column Definitions (16 columns)
 * Excludes: Own Ref, Agr No, D/O Status - Inst.
 */
const INSTALLMENT_COLUMNS = [
  { header: 'Acc No', key: 'accNo', width: 14 },
  { header: 'Name', key: 'name', width: 24 },
  { header: 'Employer', key: 'employer', width: 26 },
  { header: 'Id Number', key: 'idNumber', width: 18 },
  { header: 'Created By', key: 'createdBy', width: 22 },
  { header: 'Phone', key: 'phone', width: 16 },
  { header: 'Freq', key: 'freq', width: 12 },
  { header: 'Inst', key: 'inst', width: 10 },
  { header: 'Product', key: 'product', width: 26 },
  { header: 'Col Method', key: 'colMethod', width: 14 },
  { header: 'Due', key: 'due', width: 14 },
  { header: 'Overdue', key: 'overdue', width: 12 },
  { header: 'D/O Status', key: 'doStatus', width: 14 },
  { header: 'Inst Am', key: 'instAm', width: 14 },
  { header: 'Paid', key: 'paid', width: 12 },
  { header: 'Balance', key: 'balance', width: 14 }
];

/**
 * Build an Agreement Report Workbook (in-memory or streaming)
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.tenantId - Tenant scope
 * @param {Object} [params.res] - Optional Express response object for streaming
 * @param {Object} [params.filters] - Query filters (dateRange, status, etc.)
 * @returns {Promise<ExcelJS.Workbook|Object>} Workbook object and metrics
 */
async function generateAgreementReportWorkbook({ tenantId, res = null, filters = {} }) {
  if (!tenantId) {
    throw new Error('Tenant ID is required for Agreement Report generation');
  }

  const tenantObjectId = new mongoose.Types.ObjectId(tenantId);
  const baseQuery = { isDeleted: false, tenantId: tenantObjectId };

  if (filters.status) {
    baseQuery.loanStatus = filters.status;
  }
  if (filters.startDate || filters.endDate) {
    baseQuery.createdAt = {};
    if (filters.startDate) baseQuery.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) baseQuery.createdAt.$lte = new Date(filters.endDate);
  }

  // Pre-aggregate verified payments per loan for this tenant
  const paymentsAgg = await Payment.aggregate([
    {
      $match: {
        paymentStatus: 'Verified',
        isDeleted: false,
        tenantId: tenantObjectId
      }
    },
    {
      $group: {
        _id: '$loanId',
        totalPaid: { $sum: '$paymentAmount' }
      }
    }
  ]);
  const paymentMap = new Map();
  paymentsAgg.forEach(p => {
    paymentMap.set(String(p._id), p.totalPaid || 0);
  });

  // Pre-fetch loan status histories for channel detection
  const statusHistories = await LoanStatusHistory.find({ tenantId: tenantObjectId })
    .sort({ createdAt: 1 })
    .lean();
  const historyMap = new Map();
  statusHistories.forEach(h => {
    const appId = String(h.loanApplicationId);
    if (!historyMap.has(appId)) {
      historyMap.set(appId, []);
    }
    historyMap.get(appId).push(h);
  });

  const loans = await ActiveLoan.find(baseQuery)
    .populate('borrowerId', 'borrowerCode fullName idNumber phoneNumber')
    .populate('approvedBy', 'fullName name email')
    .sort({ createdAt: 1 })
    .lean();

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('sheet1', {
    properties: { defaultRowHeight: 20 }
  });

  // Define columns
  worksheet.columns = AGREEMENT_COLUMNS.map(c => ({
    header: c.header,
    key: c.key,
    width: c.width
  }));

  // Style header row (Calibri 12 regular, matching reference)
  const headerRow = worksheet.getRow(1);
  headerRow.font = { name: 'Calibri', size: 12, bold: false };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };

  // Running accumulators for totals row
  let sumCapital = 0;
  let sumIntr = 0;
  let sumIni = 0;
  let sumAdm = 0;
  let sumVAT = 0;
  let sumPayments = 0;
  let sumBalance = 0;

  // Channel classification metrics
  let countOnline = 0;
  let countManual = 0;
  let countIndeterminate = 0;

  loans.forEach((loan, idx) => {
    const borrower = loan.borrowerId || {};
    const approvedBy = loan.approvedBy || {};
    const appId = loan.loanApplicationId ? String(loan.loanApplicationId) : '';
    const historyEntries = historyMap.get(appId) || [];

    const channel = detectChannelFromHistory(historyEntries);
    if (channel === 'Online Applications') countOnline++;
    else if (channel === 'Manually') countManual++;
    else countIndeterminate++;

    const capital = round2(loan.approvedAmount || loan.financialSnapshot?.principalAmount || 0);
    const intr = round2(loan.financialSnapshot?.pureInterestAmount || 0);
    const ini = round2(loan.financialSnapshot?.initiationFeeAmount || 0);
    const adm = round2(loan.financialSnapshot?.totalServiceFeeAmount || 0);
    const vat = round2(loan.financialSnapshot?.vatAmount || 0);
    const deferred = round2(capital + ini);

    const verifiedPaid = paymentMap.get(String(loan._id)) || 0;
    // Format payments as negative numbers matching reference workbook
    const payments = verifiedPaid > 0 ? -round2(verifiedPaid) : 0;
    const balance = round2(loan.remainingBalance != null ? loan.remainingBalance : 0);

    sumCapital += capital;
    sumIntr += intr;
    sumIni += ini;
    sumAdm += adm;
    sumVAT += vat;
    sumPayments += payments;
    sumBalance += balance;

    const row = worksheet.addRow({
      accNo: borrower.borrowerCode || 'N/A',
      name: loan.borrowerName || borrower.fullName || '',
      channel: channel,
      idNumber: loan.idNumber || borrower.idNumber || '',
      createdBy: approvedBy.fullName || approvedBy.name || approvedBy.email || '',
      terms: Number(loan.loanDurationMonths || loan.financialSnapshot?.durationMonths || 1),
      product: loan.loanType || 'Short Term Loan',
      created: formatDateDDMMYYYY(loan.approvedDate || loan.createdAt),
      deferred: deferred,
      capital: capital,
      intr: intr,
      ini: ini,
      adm: adm,
      vat: vat,
      payments: payments,
      balance: balance
    });

    row.font = { name: 'Calibri', size: 12 };
  });

  // Append Totals Row (static values matching reference layout)
  const totalsRow = worksheet.addRow({
    accNo: '',
    name: '',
    channel: '',
    idNumber: '',
    createdBy: '',
    terms: '',
    product: '',
    created: '',
    deferred: 'Totals',
    capital: round2(sumCapital),
    intr: round2(sumIntr),
    ini: round2(sumIni),
    adm: round2(sumAdm),
    vat: round2(sumVAT),
    payments: round2(sumPayments),
    balance: round2(sumBalance)
  });
  totalsRow.font = { name: 'Calibri', size: 12 };

  const metrics = {
    totalLoans: loans.length,
    channelOnline: countOnline,
    channelManual: countManual,
    channelIndeterminate: countIndeterminate,
    sumCapital: round2(sumCapital),
    sumPayments: round2(sumPayments),
    sumBalance: round2(sumBalance)
  };

  if (res) {
    await workbook.xlsx.write(res);
    res.end();
  }

  return { workbook, metrics };
}

/**
 * Build an Installment Report Workbook (in-memory or streaming)
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.tenantId - Tenant scope
 * @param {Object} [params.res] - Optional Express response object for streaming
 * @param {Object} [params.filters] - Query filters
 * @returns {Promise<ExcelJS.Workbook|Object>} Workbook object and metrics
 */
async function generateInstallmentReportWorkbook({ tenantId, res = null, filters = {} }) {
  if (!tenantId) {
    throw new Error('Tenant ID is required for Installment Report generation');
  }

  const tenantObjectId = new mongoose.Types.ObjectId(tenantId);
  const baseQuery = { isDeleted: false, tenantId: tenantObjectId };

  if (filters.status) {
    baseQuery.loanStatus = filters.status;
  }

  const loans = await ActiveLoan.find(baseQuery)
    .populate('borrowerId', 'borrowerCode fullName employerName idNumber phoneNumber collectionProfile')
    .populate('approvedBy', 'fullName name email')
    .populate('loanApplicationId', 'debicheckMandateStatus nupayMandate')
    .sort({ createdAt: 1 })
    .lean();

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('sheet1', {
    properties: { defaultRowHeight: 20 }
  });

  worksheet.columns = INSTALLMENT_COLUMNS.map(c => ({
    header: c.header,
    key: c.key,
    width: c.width
  }));

  const headerRow = worksheet.getRow(1);
  headerRow.font = { name: 'Calibri', size: 12, bold: false };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };

  let sumInstAm = 0;
  let sumPaid = 0;
  let sumBalance = 0;
  let totalInstallments = 0;

  loans.forEach(loan => {
    const borrower = loan.borrowerId || {};
    const approvedBy = loan.approvedBy || {};
    const colMethod = resolveCollectionMethodLabel(borrower.collectionProfile?.collectionMethod);
    const doStatus = resolveDebitOrderStatus(loan);
    const schedule = loan.repaymentSchedule || [];

    schedule.forEach(inst => {
      totalInstallments++;
      const emiAmount = round2(inst.emiAmount || 0);
      const paid = round2(inst.amountPaid || 0);
      const penalty = inst.penaltyWaived ? 0 : round2(inst.lateFee || 0);
      const totalDue = round2(emiAmount + penalty);
      const balance = Math.max(0, round2(totalDue - paid));

      sumInstAm += emiAmount;
      sumPaid += paid;
      sumBalance += balance;

      const row = worksheet.addRow({
        accNo: borrower.borrowerCode || 'N/A',
        name: loan.borrowerName || borrower.fullName || '',
        employer: borrower.employerName || '',
        idNumber: loan.idNumber || borrower.idNumber || '',
        createdBy: approvedBy.fullName || approvedBy.name || approvedBy.email || '',
        phone: loan.borrowerPhone || borrower.phoneNumber || '',
        freq: 'Monthly',
        inst: Number(inst.installmentNumber || 1),
        product: loan.loanType || 'Short Term Loan',
        colMethod: colMethod,
        due: formatDateDDMMYYYY(inst.dueDate),
        overdue: round2(inst.lateFee || 0),
        doStatus: doStatus,
        instAm: emiAmount,
        paid: paid,
        balance: balance
      });

      row.font = { name: 'Calibri', size: 12 };
    });
  });

  // Append Totals Row (static values matching reference layout)
  const totalsRow = worksheet.addRow({
    accNo: '',
    name: '',
    employer: '-',
    idNumber: '',
    createdBy: '',
    phone: '',
    freq: '',
    inst: '',
    product: '',
    colMethod: '',
    due: '',
    overdue: '',
    doStatus: '-',
    instAm: round2(sumInstAm),
    paid: round2(sumPaid),
    balance: round2(sumBalance)
  });
  totalsRow.font = { name: 'Calibri', size: 12 };

  const metrics = {
    totalLoans: loans.length,
    totalInstallments,
    sumInstAm: round2(sumInstAm),
    sumPaid: round2(sumPaid),
    sumBalance: round2(sumBalance)
  };

  if (res) {
    await workbook.xlsx.write(res);
    res.end();
  }

  return { workbook, metrics };
}

module.exports = {
  detectChannelFromHistory,
  resolveCollectionMethodLabel,
  resolveDebitOrderStatus,
  formatDateDDMMYYYY,
  generateAgreementReportWorkbook,
  generateInstallmentReportWorkbook,
  AGREEMENT_COLUMNS,
  INSTALLMENT_COLUMNS
};
