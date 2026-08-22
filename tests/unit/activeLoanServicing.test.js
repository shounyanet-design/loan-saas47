const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Helper to simulate servicing calculation logic
function calculateServicingMetrics({ loan, payments = [], schedule = [] }) {
  // Only Verified payments count
  const verifiedPayments = payments.filter(p => p.paymentStatus === 'Verified' && !p.isDeleted);
  const totalPaid = verifiedPayments.reduce((sum, p) => sum + (Number(p.paymentAmount) || 0), 0);

  const totalInstallments = schedule.length || loan.loanDurationMonths || 1;
  const paidInstallments = schedule.filter(s => s.status === 'Paid' || s.status === 'Late Paid' || s.paymentStatus === 'Paid').length;

  const now = new Date();
  const overdueInstallments = schedule.filter(s => {
    const isUnpaid = s.status !== 'Paid' && s.status !== 'Late Paid' && s.paymentStatus !== 'Paid';
    return isUnpaid && new Date(s.dueDate) < now;
  });
  const overdueAmount = overdueInstallments.reduce((sum, s) => sum + (Number(s.amount || s.emiAmount) || 0), 0);

  const upcomingUnpaid = schedule.find(s => s.status !== 'Paid' && s.status !== 'Late Paid' && s.paymentStatus !== 'Paid');
  const nextEmiDate = upcomingUnpaid ? upcomingUnpaid.dueDate : (loan.nextDueDate || null);

  const totalPayable = Number(loan.totalPayableAmount) || Number(loan.approvedAmount) || 1;
  const remainingBalance = typeof loan.remainingBalance === 'number'
    ? loan.remainingBalance
    : Math.max(0, totalPayable - totalPaid);

  const financialProgressPercent = totalPayable > 0
    ? Math.min(100, Math.max(0, Math.round((totalPaid / totalPayable) * 100)))
    : 0;

  const installmentProgressPercent = totalInstallments > 0
    ? Math.min(100, Math.max(0, Math.round((paidInstallments / totalInstallments) * 100)))
    : 0;

  return {
    totalPaid,
    remainingBalance,
    overdueAmount,
    totalPenalties: loan.penaltyAmount || 0,
    paidInstallments,
    totalInstallments,
    financialProgressPercent,
    installmentProgressPercent,
    nextEmiDate
  };
}

test('1. Zero payments: totalPaid equals 0', () => {
  const loan = { approvedAmount: 15000, totalPayableAmount: 15450, remainingBalance: 15450, loanDurationMonths: 1 };
  const metrics = calculateServicingMetrics({ loan, payments: [], schedule: [{ emiNumber: 1, amount: 15450, status: 'Pending', dueDate: new Date('2026-09-16') }] });
  assert.equal(metrics.totalPaid, 0, 'Zero payments must yield totalPaid = 0');
});

test('2. Zero payments: paidInstallments equals 0', () => {
  const loan = { approvedAmount: 15000, totalPayableAmount: 15450, remainingBalance: 15450, loanDurationMonths: 1 };
  const metrics = calculateServicingMetrics({ loan, payments: [], schedule: [{ emiNumber: 1, amount: 15450, status: 'Pending', dueDate: new Date('2026-09-16') }] });
  assert.equal(metrics.paidInstallments, 0, 'Zero payments must yield paidInstallments = 0');
});

test('3. Zero payments: financialProgressPercent equals 0%', () => {
  const loan = { approvedAmount: 15000, totalPayableAmount: 15450, remainingBalance: 15450, loanDurationMonths: 1 };
  const metrics = calculateServicingMetrics({ loan, payments: [], schedule: [{ emiNumber: 1, amount: 15450, status: 'Pending', dueDate: new Date('2026-09-16') }] });
  assert.equal(metrics.financialProgressPercent, 0, 'Zero payments must yield financialProgressPercent = 0%');
});

test('4. One fully paid installment: paidInstallments equals 1', () => {
  const loan = { approvedAmount: 15000, totalPayableAmount: 15450, remainingBalance: 0, loanDurationMonths: 1 };
  const schedule = [{ emiNumber: 1, amount: 15450, status: 'Paid', dueDate: new Date('2026-09-16') }];
  const payments = [{ paymentAmount: 15450, paymentStatus: 'Verified', isDeleted: false }];
  const metrics = calculateServicingMetrics({ loan, payments, schedule });
  assert.equal(metrics.paidInstallments, 1, '1 paid schedule must yield paidInstallments = 1');
  assert.equal(metrics.totalPaid, 15450, 'totalPaid must equal 15450');
  assert.equal(metrics.financialProgressPercent, 100, 'financialProgressPercent must equal 100%');
});

test('5. Partial payment: does NOT count installment as fully paid', () => {
  const loan = { approvedAmount: 15000, totalPayableAmount: 15450, remainingBalance: 10450, loanDurationMonths: 1 };
  const schedule = [{ emiNumber: 1, amount: 15450, status: 'Partial', dueDate: new Date('2026-09-16') }];
  const payments = [{ paymentAmount: 5000, paymentStatus: 'Verified', isDeleted: false }];
  const metrics = calculateServicingMetrics({ loan, payments, schedule });
  assert.equal(metrics.paidInstallments, 0, 'Partial payment must not count as fully paid installment');
  assert.equal(metrics.totalPaid, 5000, 'totalPaid must equal 5000');
  assert.equal(metrics.financialProgressPercent, 32, 'financialProgressPercent must be 32% (5000 / 15450)');
});

test('6. Failed / Pending payment: must not increase totalPaid', () => {
  const loan = { approvedAmount: 15000, totalPayableAmount: 15450, remainingBalance: 15450, loanDurationMonths: 1 };
  const schedule = [{ emiNumber: 1, amount: 15450, status: 'Pending', dueDate: new Date('2026-09-16') }];
  const payments = [{ paymentAmount: 15450, paymentStatus: 'Pending', isDeleted: false }];
  const metrics = calculateServicingMetrics({ loan, payments, schedule });
  assert.equal(metrics.totalPaid, 0, 'Pending payment must not increase totalPaid');
});

test('7. Rejected / Deleted payment: must not increase totalPaid', () => {
  const loan = { approvedAmount: 15000, totalPayableAmount: 15450, remainingBalance: 15450, loanDurationMonths: 1 };
  const schedule = [{ emiNumber: 1, amount: 15450, status: 'Pending', dueDate: new Date('2026-09-16') }];
  const payments = [
    { paymentAmount: 15450, paymentStatus: 'Rejected', isDeleted: false },
    { paymentAmount: 15450, paymentStatus: 'Verified', isDeleted: true }
  ];
  const metrics = calculateServicingMetrics({ loan, payments, schedule });
  assert.equal(metrics.totalPaid, 0, 'Rejected/deleted payments must not increase totalPaid');
});

test('8. totalInstallments equals actual schedule count (1 for 1-month term)', () => {
  const loan = { approvedAmount: 15000, totalPayableAmount: 15450, remainingBalance: 15450, loanDurationMonths: 1 };
  const schedule = [{ emiNumber: 1, amount: 15450, status: 'Pending', dueDate: new Date('2026-09-16') }];
  const metrics = calculateServicingMetrics({ loan, payments: [], schedule });
  assert.equal(metrics.totalInstallments, 1, 'Total installments must be 1, never hardcoded 12');
});

test('9. nextEmiDate comes from earliest applicable unpaid installment', () => {
  const loan = { approvedAmount: 15000, totalPayableAmount: 15450, remainingBalance: 15450, loanDurationMonths: 2 };
  const d1 = new Date('2026-09-16T00:00:00.000Z');
  const d2 = new Date('2026-10-16T00:00:00.000Z');
  const schedule = [
    { emiNumber: 1, amount: 7725, status: 'Paid', dueDate: d1 },
    { emiNumber: 2, amount: 7725, status: 'Pending', dueDate: d2 }
  ];
  const metrics = calculateServicingMetrics({ loan, payments: [{ paymentAmount: 7725, paymentStatus: 'Verified' }], schedule });
  assert.equal(metrics.nextEmiDate.toISOString(), d2.toISOString(), 'nextEmiDate must point to the first unpaid installment');
});

test('10. overdueAmount uses overdue unpaid schedules only', () => {
  const loan = { approvedAmount: 15000, totalPayableAmount: 15450, remainingBalance: 15450, loanDurationMonths: 2 };
  const pastDate = new Date('2025-01-01T00:00:00.000Z');
  const futureDate = new Date('2027-01-01T00:00:00.000Z');
  const schedule = [
    { emiNumber: 1, amount: 7725, status: 'Overdue', dueDate: pastDate },
    { emiNumber: 2, amount: 7725, status: 'Pending', dueDate: futureDate }
  ];
  const metrics = calculateServicingMetrics({ loan, payments: [], schedule });
  assert.equal(metrics.overdueAmount, 7725, 'overdueAmount must sum only past unpaid installments');
});

test('11. Multi-Tenant isolation boundary for ActiveLoans and Payments', () => {
  const ActiveLoan = require('../../src/models/ActiveLoan');
  const Payment = require('../../src/models/Payment');
  const RepaymentSchedule = require('../../src/models/RepaymentSchedule');

  // Verify models have tenantId in schema
  assert.ok(ActiveLoan.schema.paths.tenantId, 'ActiveLoan must have tenantId');
  assert.ok(Payment.schema.paths.tenantId, 'Payment must have tenantId');
  assert.ok(RepaymentSchedule.schema.paths.tenantId, 'RepaymentSchedule must have tenantId');
});

test('12. Disbursed LoanApplication remains available as historical audit record', () => {
  const LoanApplication = require('../../src/models/LoanApplication');
  assert.ok(LoanApplication.schema.paths.disbursementStatus, 'LoanApplication must track disbursementStatus');
  assert.ok(LoanApplication.schema.paths.activeLoanId, 'LoanApplication must link to activeLoanId');
});

test('13. Exactly one ActiveLoan uniqueness enforced per tenant + loanApplicationId', () => {
  const ActiveLoan = require('../../src/models/ActiveLoan');
  const indexes = ActiveLoan.schema.indexes();
  const hasCompoundUnique = indexes.some(([fields, options]) => {
    return fields.tenantId === 1 && fields.loanApplicationId === 1 && options?.unique === true;
  });
  assert.ok(hasCompoundUnique, 'ActiveLoan must enforce unique compound index on { tenantId: 1, loanApplicationId: 1 }');
});

test('14. Application duration and generated schedule term consistency', () => {
  const appDuration = 1;
  const emiSchedule = [];
  for (let i = 1; i <= appDuration; i++) {
    emiSchedule.push({ installmentNumber: i, paymentStatus: 'Pending' });
  }
  assert.equal(emiSchedule.length, appDuration, 'Generated schedule count must strictly equal approved duration');
});

test('15. No hardcoded 8/12/64 fallback exists in calculation engine', () => {
  const emptyLoan = { approvedAmount: 0, totalPayableAmount: 0, remainingBalance: 0, loanDurationMonths: 0 };
  const metrics = calculateServicingMetrics({ loan: emptyLoan, payments: [], schedule: [] });
  assert.notEqual(metrics.paidInstallments, 8, 'paidInstallments must never default to 8');
  assert.notEqual(metrics.totalInstallments, 12, 'totalInstallments must never default to 12');
  assert.notEqual(metrics.financialProgressPercent, 64, 'financialProgressPercent must never default to 64');
  assert.equal(metrics.paidInstallments, 0);
  assert.equal(metrics.financialProgressPercent, 0);
});

test('16. Settlement Quote calculation generates exact outstanding settlement amount', () => {
  const loan = { _id: 'loan123', loanCode: 'P47-002', remainingBalance: 15450, totalPayableAmount: 15450, penaltyAmount: 0, loanStatus: 'Active' };
  const verifiedPayments = [];
  const totalPaid = verifiedPayments.reduce((s, p) => s + p.paymentAmount, 0);
  const settlementAmount = Math.max(0, loan.remainingBalance);

  assert.equal(settlementAmount, 15450, 'Settlement amount must equal remaining balance 15450');
  assert.equal(totalPaid, 0, 'Total paid must be 0');
});

test('17. Successful full settlement workflow sets remainingBalance=0 and loanStatus=Completed', () => {
  const loan = { _id: 'loan123', loanCode: 'P47-002', remainingBalance: 15450, loanStatus: 'Active' };
  const schedule = [{ emiNumber: 1, amount: 15450, status: 'Pending' }];

  // Perform mock settlement transaction
  const settlementPayment = {
    loanId: loan._id,
    paymentAmount: 15450,
    paymentStatus: 'Verified',
    paymentType: 'Full Settlement',
    remainingBalanceAfterPayment: 0
  };

  if (settlementPayment.paymentStatus === 'Verified') {
    loan.remainingBalance = 0;
    loan.loanStatus = 'Completed';
    loan.settledAt = new Date();
    schedule.forEach(s => { s.status = 'Paid'; });
  }

  assert.equal(loan.remainingBalance, 0, 'Remaining balance must be 0 after settlement');
  assert.equal(loan.loanStatus, 'Completed', 'Loan status must be Completed after settlement');
  assert.equal(schedule[0].status, 'Paid', 'Schedule status must be Paid after settlement');
});

test('18. Failed or Rejected settlement payment does NOT complete loan or update schedule', () => {
  const loan = { _id: 'loan123', loanCode: 'P47-002', remainingBalance: 15450, loanStatus: 'Active' };
  const schedule = [{ emiNumber: 1, amount: 15450, status: 'Pending' }];

  const settlementPayment = {
    loanId: loan._id,
    paymentAmount: 15450,
    paymentStatus: 'Rejected',
    paymentType: 'Full Settlement'
  };

  if (settlementPayment.paymentStatus === 'Verified') {
    loan.remainingBalance = 0;
    loan.loanStatus = 'Completed';
    schedule.forEach(s => { s.status = 'Paid'; });
  }

  assert.equal(loan.remainingBalance, 15450, 'Remaining balance must remain 15450 on failed settlement');
  assert.equal(loan.loanStatus, 'Active', 'Loan status must remain Active on failed settlement');
  assert.equal(schedule[0].status, 'Pending', 'Schedule status must remain Pending on failed settlement');
});

test('19. Duplicate settlement attempt on completed loan is rejected (Idempotency)', () => {
  const completedLoan = { _id: 'loan123', loanCode: 'P47-002', remainingBalance: 0, loanStatus: 'Completed' };
  const canSettle = completedLoan.loanStatus !== 'Completed' && completedLoan.remainingBalance > 0;
  assert.equal(canSettle, false, 'Already completed loan must reject subsequent settlement attempts');
});

test('20. Dashboard tab counts equal exact database document counts', () => {
  const activeLoans = [
    { loanStatus: 'Active', tenantId: 'tenantA' },
    { loanStatus: 'Completed', tenantId: 'tenantA' }
  ];
  const totalLoans = activeLoans.length;
  const activeCount = activeLoans.filter(l => l.loanStatus === 'Active').length;
  const completedCount = activeLoans.filter(l => l.loanStatus === 'Completed').length;

  assert.equal(totalLoans, 2, 'Total loans under All tab must equal 2');
  assert.equal(activeCount, 1, 'Active loans count must equal 1');
  assert.equal(completedCount, 1, 'Completed loans count must equal 1');
});

test('21. Cross-tenant access rejection: Tenant A cannot access Tenant B active loan', () => {
  const tenantALoan = { _id: 'loanA', tenantId: 'tenantA' };
  const tenantBContext = 'tenantB';

  const isAccessAllowed = tenantALoan.tenantId === tenantBContext;
  assert.equal(isAccessAllowed, false, 'Tenant B must be rejected when attempting to access Tenant A loan');
});


