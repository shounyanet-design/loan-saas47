const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Mock helpers to test the accounting and validation mechanics of manual EMI receipt
function calculateRemainingEmiDue(schedule) {
  const effectivePenalty = schedule.penaltyWaived ? 0 : (schedule.penaltyAmount || 0);
  const totalEmiDue = Number(schedule.amount) + Number(effectivePenalty);
  const currentAmountPaid = Number(schedule.amountPaid) || 0;
  return Math.max(0, Math.round((totalEmiDue - currentAmountPaid) * 100) / 100);
}

function processManualEmiPaymentMock({ activeLoan, schedules, payments, scheduleId, paymentData, user }) {
  if (user.role !== 'admin') {
    throw new Error('Access denied: 403');
  }

  const schedule = schedules.find(s => String(s._id) === String(scheduleId));
  if (!schedule) {
    throw new Error('Repayment schedule record not found: 404');
  }

  if (activeLoan.isDeleted || activeLoan.loanStatus === 'Closed') {
    throw new Error('Cannot record payment for a closed or deleted loan: 400');
  }

  if (schedule.status === 'Paid') {
    throw new Error(`Installment #${schedule.emiNumber} is already fully paid: 400`);
  }

  const numAmount = Number(paymentData.paymentAmount);
  if (isNaN(numAmount) || numAmount <= 0) {
    throw new Error('Payment amount must be greater than zero: 400');
  }

  const remainingDue = calculateRemainingEmiDue(schedule);
  const roundedPayment = Math.round(numAmount * 100) / 100;

  if (roundedPayment > (remainingDue + 0.01)) {
    throw new Error(`Payment amount (R ${roundedPayment.toFixed(2)}) exceeds remaining due (R ${remainingDue.toFixed(2)}): 400`);
  }

  if (paymentData.transactionId) {
    const duplicate = payments.find(p => p.transactionId === paymentData.transactionId && !p.isDeleted);
    if (duplicate) {
      throw new Error(`Transaction reference "${paymentData.transactionId}" already exists: 400`);
    }
  }

  const effectivePenalty = schedule.penaltyWaived ? 0 : (schedule.penaltyAmount || 0);
  const totalEmiDue = Number(schedule.amount) + Number(effectivePenalty);

  // Update schedule
  schedule.amountPaid = Math.round(((schedule.amountPaid || 0) + roundedPayment) * 100) / 100;
  if (schedule.amountPaid >= (totalEmiDue - 0.01)) {
    schedule.status = 'Paid';
    schedule.paidAt = paymentData.paymentDate || new Date();
  } else {
    schedule.status = 'Partial';
  }

  // Record payment
  const newPayment = {
    _id: new mongoose.Types.ObjectId(),
    tenantId: activeLoan.tenantId,
    loanId: activeLoan._id,
    loanCode: activeLoan.loanCode,
    repaymentScheduleId: schedule._id,
    emiNumber: schedule.emiNumber,
    paymentAmount: roundedPayment,
    paymentDate: paymentData.paymentDate || new Date(),
    paymentMethod: paymentData.paymentMethod || 'Bank Transfer',
    paymentStatus: 'Verified',
    paymentType: 'EMI Payment',
    transactionId: paymentData.transactionId || `TRX-${Date.now()}`,
    verifiedBy: user._id,
    verifiedDate: new Date(),
    isDeleted: false
  };
  payments.push(newPayment);

  // Sync embedded
  if (Array.isArray(activeLoan.repaymentSchedule)) {
    const embedded = activeLoan.repaymentSchedule.find(s => s.installmentNumber === schedule.emiNumber);
    if (embedded) {
      embedded.amountPaid = schedule.amountPaid;
      embedded.paymentStatus = schedule.status === 'Paid' ? 'Paid' : 'Partial';
      embedded.paidDate = schedule.paidAt;
    }
  }

  // Recalculate remaining balance from authoritative verified payments
  const verifiedPayments = payments.filter(p => p.paymentStatus === 'Verified' && !p.isDeleted);
  const totalPaid = verifiedPayments.reduce((sum, p) => sum + (Number(p.paymentAmount) || 0), 0);
  const totalPayable = Number(activeLoan.totalPayableAmount) || Number(activeLoan.approvedAmount) || 0;
  activeLoan.remainingBalance = Math.max(0, Math.round((totalPayable - totalPaid) * 100) / 100);

  // Update nextDueDate
  const nextUnpaid = schedules.find(s => s.status !== 'Paid' && s.status !== 'Late Paid');
  activeLoan.nextDueDate = nextUnpaid ? nextUnpaid.dueDate : null;

  if (activeLoan.remainingBalance === 0 && schedules.every(s => s.status === 'Paid' || s.status === 'Late Paid')) {
    activeLoan.loanStatus = 'Completed';
  }

  return { schedule, payment: newPayment, activeLoan };
}

// ===================== TESTS =====================

test('1. Admin can record a full manual EMI payment', () => {
  const scheduleId = new mongoose.Types.ObjectId();
  const loanId = new mongoose.Types.ObjectId();

  const activeLoan = {
    _id: loanId,
    loanCode: 'LAPP-1001',
    approvedAmount: 3000,
    totalPayableAmount: 3150,
    remainingBalance: 3150,
    loanStatus: 'Active',
    repaymentSchedule: [
      { installmentNumber: 1, emiAmount: 1050, amountPaid: 0, paymentStatus: 'Pending', dueDate: new Date('2026-10-01') },
      { installmentNumber: 2, emiAmount: 1050, amountPaid: 0, paymentStatus: 'Pending', dueDate: new Date('2026-11-01') },
      { installmentNumber: 3, emiAmount: 1050, amountPaid: 0, paymentStatus: 'Pending', dueDate: new Date('2026-12-01') }
    ]
  };

  const schedules = [
    { _id: scheduleId, loanId, emiNumber: 1, amount: 1050, amountPaid: 0, status: 'Pending', dueDate: new Date('2026-10-01') },
    { _id: new mongoose.Types.ObjectId(), loanId, emiNumber: 2, amount: 1050, amountPaid: 0, status: 'Pending', dueDate: new Date('2026-11-01') },
    { _id: new mongoose.Types.ObjectId(), loanId, emiNumber: 3, amount: 1050, amountPaid: 0, status: 'Pending', dueDate: new Date('2026-12-01') }
  ];

  const payments = [];
  const adminUser = { _id: new mongoose.Types.ObjectId(), role: 'admin' };

  const result = processManualEmiPaymentMock({
    activeLoan,
    schedules,
    payments,
    scheduleId,
    paymentData: { paymentAmount: 1050, paymentMethod: 'Bank Transfer', transactionId: 'DEP-001' },
    user: adminUser
  });

  assert.equal(result.schedule.status, 'Paid', 'Schedule must be marked Paid');
  assert.equal(result.schedule.amountPaid, 1050, 'Schedule amountPaid must equal 1050');
  assert.equal(result.activeLoan.remainingBalance, 2100, 'Remaining balance must decrease to 2100');
  assert.equal(payments.length, 1, 'One verified payment must be created');
  assert.equal(payments[0].repaymentScheduleId, scheduleId, 'Payment must link to scheduleId');
  assert.equal(payments[0].emiNumber, 1, 'Payment must link to emiNumber 1');
  assert.equal(schedules[1].status, 'Pending', 'EMI #2 must remain unchanged');
});

test('2. Partial payment updates status to Partial and balance correctly', () => {
  const scheduleId = new mongoose.Types.ObjectId();
  const loanId = new mongoose.Types.ObjectId();

  const activeLoan = {
    _id: loanId,
    loanCode: 'LAPP-1002',
    approvedAmount: 3000,
    totalPayableAmount: 3000,
    remainingBalance: 3000,
    loanStatus: 'Active',
    repaymentSchedule: [
      { installmentNumber: 1, emiAmount: 1000, amountPaid: 0, paymentStatus: 'Pending', dueDate: new Date('2026-10-01') }
    ]
  };

  const schedules = [
    { _id: scheduleId, loanId, emiNumber: 1, amount: 1000, amountPaid: 0, status: 'Pending', dueDate: new Date('2026-10-01') }
  ];

  const payments = [];
  const adminUser = { _id: new mongoose.Types.ObjectId(), role: 'admin' };

  const result = processManualEmiPaymentMock({
    activeLoan,
    schedules,
    payments,
    scheduleId,
    paymentData: { paymentAmount: 400, paymentMethod: 'Cash Deposit' },
    user: adminUser
  });

  assert.equal(result.schedule.status, 'Partial', 'Status must be Partial');
  assert.equal(result.schedule.amountPaid, 400, 'amountPaid must be 400');
  assert.equal(result.activeLoan.remainingBalance, 2600, 'Remaining balance must be 2600');
  assert.equal(calculateRemainingEmiDue(result.schedule), 600, 'Remaining due on EMI must be 600');
});

test('3. Non-admin role receives 403 Forbidden', () => {
  assert.throws(() => {
    processManualEmiPaymentMock({
      activeLoan: {},
      schedules: [],
      payments: [],
      scheduleId: 'test',
      paymentData: { paymentAmount: 100 },
      user: { role: 'staff' }
    });
  }, /403/);
});

test('4. Overpayment on an individual EMI is rejected', () => {
  const scheduleId = new mongoose.Types.ObjectId();
  const schedules = [
    { _id: scheduleId, emiNumber: 1, amount: 500, amountPaid: 0, status: 'Pending' }
  ];

  assert.throws(() => {
    processManualEmiPaymentMock({
      activeLoan: { loanStatus: 'Active' },
      schedules,
      payments: [],
      scheduleId,
      paymentData: { paymentAmount: 600 },
      user: { role: 'admin' }
    });
  }, /exceeds remaining due/);
});

test('5. Zero or negative amount is rejected', () => {
  const scheduleId = new mongoose.Types.ObjectId();
  const schedules = [
    { _id: scheduleId, emiNumber: 1, amount: 500, amountPaid: 0, status: 'Pending' }
  ];

  assert.throws(() => {
    processManualEmiPaymentMock({
      activeLoan: { loanStatus: 'Active' },
      schedules,
      payments: [],
      scheduleId,
      paymentData: { paymentAmount: 0 },
      user: { role: 'admin' }
    });
  }, /greater than zero/);
});

test('6. Already paid installment is rejected', () => {
  const scheduleId = new mongoose.Types.ObjectId();
  const schedules = [
    { _id: scheduleId, emiNumber: 1, amount: 500, amountPaid: 500, status: 'Paid' }
  ];

  assert.throws(() => {
    processManualEmiPaymentMock({
      activeLoan: { loanStatus: 'Active' },
      schedules,
      payments: [],
      scheduleId,
      paymentData: { paymentAmount: 500 },
      user: { role: 'admin' }
    });
  }, /already fully paid/);
});

test('7. Duplicate transaction reference is rejected', () => {
  const scheduleId = new mongoose.Types.ObjectId();
  const schedules = [
    { _id: scheduleId, emiNumber: 1, amount: 500, amountPaid: 0, status: 'Pending' }
  ];
  const payments = [
    { transactionId: 'REF-12345', isDeleted: false }
  ];

  assert.throws(() => {
    processManualEmiPaymentMock({
      activeLoan: { loanStatus: 'Active' },
      schedules,
      payments,
      scheduleId,
      paymentData: { paymentAmount: 500, transactionId: 'REF-12345' },
      user: { role: 'admin' }
    });
  }, /already exists/);
});

test('8. Out-of-order payment specifically pays selected EMI without altering previous', () => {
  const schedule1Id = new mongoose.Types.ObjectId();
  const schedule2Id = new mongoose.Types.ObjectId();
  const loanId = new mongoose.Types.ObjectId();

  const activeLoan = {
    _id: loanId,
    approvedAmount: 2000,
    totalPayableAmount: 2000,
    remainingBalance: 2000,
    loanStatus: 'Active',
    repaymentSchedule: [
      { installmentNumber: 1, emiAmount: 1000, amountPaid: 0, paymentStatus: 'Pending', dueDate: new Date('2026-10-01') },
      { installmentNumber: 2, emiAmount: 1000, amountPaid: 0, paymentStatus: 'Pending', dueDate: new Date('2026-11-01') }
    ]
  };

  const schedules = [
    { _id: schedule1Id, loanId, emiNumber: 1, amount: 1000, amountPaid: 0, status: 'Pending', dueDate: new Date('2026-10-01') },
    { _id: schedule2Id, loanId, emiNumber: 2, amount: 1000, amountPaid: 0, status: 'Pending', dueDate: new Date('2026-11-01') }
  ];

  const payments = [];
  const adminUser = { role: 'admin' };

  // Pay EMI #2 directly
  const result = processManualEmiPaymentMock({
    activeLoan,
    schedules,
    payments,
    scheduleId: schedule2Id,
    paymentData: { paymentAmount: 1000 },
    user: adminUser
  });

  assert.equal(result.schedule.emiNumber, 2, 'Selected EMI must be #2');
  assert.equal(result.schedule.status, 'Paid', 'EMI #2 must be Paid');
  assert.equal(schedules[0].status, 'Pending', 'EMI #1 must remain Pending');
  assert.equal(schedules[0].amountPaid, 0, 'EMI #1 amountPaid must remain 0');
  assert.equal(result.activeLoan.remainingBalance, 1000, 'Remaining balance must be 1000');
});

test('9. Full repayment of all EMIs completes the loan', () => {
  const scheduleId = new mongoose.Types.ObjectId();
  const loanId = new mongoose.Types.ObjectId();

  const activeLoan = {
    _id: loanId,
    approvedAmount: 1000,
    totalPayableAmount: 1000,
    remainingBalance: 1000,
    loanStatus: 'Active',
    repaymentSchedule: [
      { installmentNumber: 1, emiAmount: 1000, amountPaid: 0, paymentStatus: 'Pending', dueDate: new Date('2026-10-01') }
    ]
  };

  const schedules = [
    { _id: scheduleId, loanId, emiNumber: 1, amount: 1000, amountPaid: 0, status: 'Pending', dueDate: new Date('2026-10-01') }
  ];

  const payments = [];
  const adminUser = { role: 'admin' };

  const result = processManualEmiPaymentMock({
    activeLoan,
    schedules,
    payments,
    scheduleId,
    paymentData: { paymentAmount: 1000 },
    user: adminUser
  });

  assert.equal(result.activeLoan.remainingBalance, 0, 'Balance must be 0');
  assert.equal(result.activeLoan.loanStatus, 'Completed', 'Loan status must become Completed');
});
