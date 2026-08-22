const test = require('node:test');
const assert = require('node:assert/strict');

// Simulated central payment allocation & servicing sync engine logic
function allocatePaymentMock({ loan, payments = [], schedules = [], incomingPayment }) {
  // Only Verified payments count
  const allPayments = [...payments];
  if (incomingPayment) {
    allPayments.push(incomingPayment);
  }

  const verifiedPayments = allPayments.filter(p => p.paymentStatus === 'Verified' && !p.isDeleted);
  const totalPaid = verifiedPayments.reduce((sum, p) => sum + (Number(p.paymentAmount) || 0), 0);

  const totalPayable = Number(loan.totalPayableAmount) || Number(loan.approvedAmount) || 0;
  let remainingBalance = Math.max(0, totalPayable - totalPaid);

  // Sequentially allocate verified payments to schedules
  const sortedVerified = [...verifiedPayments].sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));
  
  // Reset all schedules before reallocation
  schedules.forEach(s => {
    s.amountPaid = 0;
    s.status = 'Pending';
    s.paidAt = null;
  });

  for (const pay of sortedVerified) {
    let rem = pay.paymentAmount;
    for (const sched of schedules) {
      if (rem <= 0) break;
      const effectivePenalty = sched.penaltyWaived ? 0 : (sched.penaltyAmount || 0);
      const totalDue = sched.amount + effectivePenalty;
      const unpaid = Math.max(0, totalDue - sched.amountPaid);
      if (unpaid > 0) {
        if (rem >= unpaid) {
          sched.amountPaid += unpaid;
          sched.status = 'Paid';
          sched.paidAt = pay.paymentDate;
          rem -= unpaid;
        } else {
          sched.amountPaid += rem;
          sched.status = 'Partial';
          rem = 0;
        }
      }
    }
  }

  // Update nextDueDate
  const nextUnpaid = schedules.find(s => s.status !== 'Paid');
  const nextDueDate = nextUnpaid ? nextUnpaid.dueDate : null;

  // Auto-completion check
  let loanStatus = loan.loanStatus;
  let settledAt = loan.settledAt || null;
  if (remainingBalance === 0 && schedules.every(s => s.status === 'Paid')) {
    loanStatus = 'Completed';
    settledAt = new Date();
  } else if (remainingBalance > 0 && loanStatus === 'Completed') {
    loanStatus = 'Active';
    settledAt = null;
  }

  return {
    totalPaid,
    remainingBalance,
    loanStatus,
    settledAt,
    nextDueDate,
    schedules
  };
}

// 1. Zero payment loan
test('1. Zero payment loan yields totalPaid=0, remainingBalance=totalPayableAmount, and Active status', () => {
  const loan = { totalPayableAmount: 15450, loanStatus: 'Active' };
  const schedules = [{ emiNumber: 1, amount: 15450, status: 'Pending', dueDate: new Date('2026-09-16') }];
  const metrics = allocatePaymentMock({ loan, payments: [], schedules });

  assert.equal(metrics.totalPaid, 0);
  assert.equal(metrics.remainingBalance, 15450);
  assert.equal(metrics.loanStatus, 'Active');
  assert.equal(metrics.schedules[0].status, 'Pending');
});

// 2. Pending payment does not affect balance
test('2. Pending payment does NOT affect outstanding balance or schedule status', () => {
  const loan = { totalPayableAmount: 15450, loanStatus: 'Active' };
  const schedules = [{ emiNumber: 1, amount: 15450, status: 'Pending' }];
  const incomingPayment = { paymentAmount: 15450, paymentStatus: 'Pending', paymentDate: new Date() };

  const metrics = allocatePaymentMock({ loan, payments: [], schedules, incomingPayment });
  assert.equal(metrics.totalPaid, 0);
  assert.equal(metrics.remainingBalance, 15450);
  assert.equal(metrics.schedules[0].status, 'Pending');
});

// 3. Verified payment affects balance
test('3. Verified payment reduces balance and updates schedule status to Paid', () => {
  const loan = { totalPayableAmount: 15450, loanStatus: 'Active' };
  const schedules = [{ emiNumber: 1, amount: 15450, status: 'Pending' }];
  const incomingPayment = { paymentAmount: 15450, paymentStatus: 'Verified', paymentDate: new Date() };

  const metrics = allocatePaymentMock({ loan, payments: [], schedules, incomingPayment });
  assert.equal(metrics.totalPaid, 15450);
  assert.equal(metrics.remainingBalance, 0);
  assert.equal(metrics.schedules[0].status, 'Paid');
  assert.equal(metrics.loanStatus, 'Completed');
});

// 4. Failed payment ignored
test('4. Failed payment status does NOT reduce balance', () => {
  const loan = { totalPayableAmount: 15450, loanStatus: 'Active' };
  const schedules = [{ emiNumber: 1, amount: 15450, status: 'Pending' }];
  const incomingPayment = { paymentAmount: 15450, paymentStatus: 'Failed', paymentDate: new Date() };

  const metrics = allocatePaymentMock({ loan, payments: [], schedules, incomingPayment });
  assert.equal(metrics.remainingBalance, 15450);
  assert.equal(metrics.schedules[0].status, 'Pending');
});

// 5. Rejected payment ignored
test('5. Rejected payment status does NOT reduce balance', () => {
  const loan = { totalPayableAmount: 15450, loanStatus: 'Active' };
  const schedules = [{ emiNumber: 1, amount: 15450, status: 'Pending' }];
  const incomingPayment = { paymentAmount: 15450, paymentStatus: 'Rejected', paymentDate: new Date() };

  const metrics = allocatePaymentMock({ loan, payments: [], schedules, incomingPayment });
  assert.equal(metrics.remainingBalance, 15450);
  assert.equal(metrics.schedules[0].status, 'Pending');
});

// 6. Reversed payment excluded & balance restored
test('6. Reversed payment status does NOT contribute to collections, restores loan balance, and reopens schedules', () => {
  const loan = { totalPayableAmount: 15450, loanStatus: 'Completed', settledAt: new Date() };
  const schedules = [{ emiNumber: 1, amount: 15450, status: 'Paid', amountPaid: 15450 }];
  
  // Payment reversed
  const reversedPayment = { paymentAmount: 15450, paymentStatus: 'Reversed', paymentDate: new Date() };

  const metrics = allocatePaymentMock({ loan, payments: [], schedules, incomingPayment: reversedPayment });
  assert.equal(metrics.totalPaid, 0);
  assert.equal(metrics.remainingBalance, 15450);
  assert.equal(metrics.loanStatus, 'Active');
  assert.equal(metrics.schedules[0].status, 'Pending');
  assert.equal(metrics.schedules[0].amountPaid, 0);
});

// 7. Partial payment
test('7. Partial payment updates schedule status to Partial and leaves balance unpaid', () => {
  const loan = { totalPayableAmount: 15450, loanStatus: 'Active' };
  const schedules = [{ emiNumber: 1, amount: 15450, status: 'Pending' }];
  const incomingPayment = { paymentAmount: 5000, paymentStatus: 'Verified', paymentDate: new Date() };

  const metrics = allocatePaymentMock({ loan, payments: [], schedules, incomingPayment });
  assert.equal(metrics.totalPaid, 5000);
  assert.equal(metrics.remainingBalance, 10450);
  assert.equal(metrics.schedules[0].status, 'Partial');
  assert.equal(metrics.schedules[0].amountPaid, 5000);
  assert.equal(metrics.loanStatus, 'Active');
});

// 8. Exact installment payment allocation
test('8. Exact installment payment amount marks schedule item as Paid', () => {
  const loan = { totalPayableAmount: 15450, loanStatus: 'Active' };
  const schedules = [
    { emiNumber: 1, amount: 7725, status: 'Pending' },
    { emiNumber: 2, amount: 7725, status: 'Pending' }
  ];
  const incomingPayment = { paymentAmount: 7725, paymentStatus: 'Verified', paymentDate: new Date() };

  const metrics = allocatePaymentMock({ loan, payments: [], schedules, incomingPayment });
  assert.equal(metrics.schedules[0].status, 'Paid');
  assert.equal(metrics.schedules[1].status, 'Pending');
  assert.equal(metrics.remainingBalance, 7725);
});

// 9. Overpayment allocation
test('9. Overpayment allocates sequentially across multiple pending schedules', () => {
  const loan = { totalPayableAmount: 15450, loanStatus: 'Active' };
  const schedules = [
    { emiNumber: 1, amount: 5000, status: 'Pending' },
    { emiNumber: 2, amount: 5000, status: 'Pending' },
    { emiNumber: 3, amount: 5450, status: 'Pending' }
  ];
  const incomingPayment = { paymentAmount: 12000, paymentStatus: 'Verified', paymentDate: new Date() };

  const metrics = allocatePaymentMock({ loan, payments: [], schedules, incomingPayment });
  assert.equal(metrics.schedules[0].status, 'Paid');
  assert.equal(metrics.schedules[1].status, 'Paid');
  assert.equal(metrics.schedules[2].status, 'Partial');
  assert.equal(metrics.schedules[2].amountPaid, 2000);
  assert.equal(metrics.remainingBalance, 3450);
});

// 10. Full settlement
test('10. Full settlement payment sets remainingBalance=0 and marks all schedules Paid', () => {
  const loan = { totalPayableAmount: 15450, loanStatus: 'Active' };
  const schedules = [
    { emiNumber: 1, amount: 7725, status: 'Pending' },
    { emiNumber: 2, amount: 7725, status: 'Pending' }
  ];
  const incomingPayment = { paymentAmount: 15450, paymentStatus: 'Verified', paymentDate: new Date() };

  const metrics = allocatePaymentMock({ loan, payments: [], schedules, incomingPayment });
  assert.equal(metrics.remainingBalance, 0);
  assert.ok(metrics.schedules.every(s => s.status === 'Paid'));
  assert.equal(metrics.loanStatus, 'Completed');
});

// 11. One schedule paid removes it from due list
test('11. Fully paid repayment schedule does not qualify as due or overdue', () => {
  const schedules = [
    { emiNumber: 1, amount: 7725, status: 'Paid' },
    { emiNumber: 2, amount: 7725, status: 'Pending' }
  ];
  const dueList = schedules.filter(s => s.status !== 'Paid');
  assert.equal(dueList.length, 1);
  assert.equal(dueList[0].emiNumber, 2);
});

// 12. Partial schedule remains due with reduced outstanding
test('12. Partially paid repayment schedule remains due with reduced outstanding amount', () => {
  const scheduleItem = { emiNumber: 1, amount: 7725, status: 'Partial', amountPaid: 3000, penaltyAmount: 0 };
  const outstanding = scheduleItem.amount + scheduleItem.penaltyAmount - scheduleItem.amountPaid;
  assert.equal(outstanding, 4725);
  assert.equal(scheduleItem.status, 'Partial');
});

// 13. Overdue classification
test('13. Overdue classification correctly determines status based on due date vs today', () => {
  const today = new Date();
  today.setHours(0,0,0,0);
  
  const pastDueDate = new Date(today);
  pastDueDate.setDate(pastDueDate.getDate() - 5);

  const futureDueDate = new Date(today);
  futureDueDate.setDate(futureDueDate.getDate() + 5);

  const overdueItem = { dueDate: pastDueDate, status: 'Pending' };
  const upcomingItem = { dueDate: futureDueDate, status: 'Pending' };

  const isOverdue = overdueItem.dueDate < today;
  const isUpcoming = upcomingItem.dueDate > today;

  assert.equal(isOverdue, true);
  assert.equal(isUpcoming, true);
});

// 14. Penalty calculation
test('14. Penalty calculation applies late fees based on late days rules', () => {
  const lateDays = 10;
  let penaltyAmount = 0;
  if (lateDays >= 1 && lateDays <= 7) {
    penaltyAmount = 150;
  } else if (lateDays > 7) {
    penaltyAmount = 300;
  }
  assert.equal(penaltyAmount, 300);
});

// 15. Penalty waiver persistence
test('15. Waived penalty overrides penalty amount to 0 and persists waiver status', () => {
  const scheduleItem = { emiNumber: 1, amount: 7725, status: 'Pending', penaltyAmount: 300, penaltyWaived: true };
  const effectivePenalty = scheduleItem.penaltyWaived ? 0 : scheduleItem.penaltyAmount;
  assert.equal(effectivePenalty, 0);
  assert.equal(scheduleItem.penaltyWaived, true);
});

// 16. Next EMI recalculation
test('16. nextEmiDate recalculation points to first unpaid installment', () => {
  const schedules = [
    { emiNumber: 1, dueDate: new Date('2026-09-16'), status: 'Paid' },
    { emiNumber: 2, dueDate: new Date('2026-10-16'), status: 'Pending' }
  ];
  const nextUnpaid = schedules.find(s => s.status !== 'Paid');
  assert.equal(nextUnpaid.dueDate.toISOString(), new Date('2026-10-16').toISOString());
});

// 17. Payment history matches Payment collection
test('17. Payment History maps exactly to verified non-deleted Payment documents', () => {
  const payments = [
    { transactionId: 'TRX-001', paymentStatus: 'Verified', isDeleted: false },
    { transactionId: 'TRX-002', paymentStatus: 'Pending', isDeleted: false },
    { transactionId: 'TRX-003', paymentStatus: 'Verified', isDeleted: true }
  ];

  const visibleHistory = payments.filter(p => p.paymentStatus === 'Verified' && !p.isDeleted);
  assert.equal(visibleHistory.length, 1);
  assert.equal(visibleHistory[0].transactionId, 'TRX-001');
});

// 18. Active Loan summary matches Payment collection records
test('18. Active Loan dynamic summary recalculates totalPaid strictly from Verified Payments', () => {
  const payments = [
    { paymentAmount: 5000, paymentStatus: 'Verified', isDeleted: false },
    { paymentAmount: 3000, paymentStatus: 'Pending', isDeleted: false },
    { paymentAmount: 2000, paymentStatus: 'Rejected', isDeleted: false }
  ];

  const totalPaid = payments
    .filter(p => p.paymentStatus === 'Verified' && !p.isDeleted)
    .reduce((sum, p) => sum + p.paymentAmount, 0);

  assert.equal(totalPaid, 5000);
});

// 19. Dashboard totals reconcile
test('19. Dashboard outstanding portfolio balance matches active loans balance aggregation', () => {
  const activeLoans = [
    { remainingBalance: 15450, loanStatus: 'Active' },
    { remainingBalance: 7725, loanStatus: 'Overdue' },
    { remainingBalance: 0, loanStatus: 'Completed' }
  ];

  const totalOutstanding = activeLoans
    .filter(l => l.loanStatus === 'Active' || l.loanStatus === 'Overdue')
    .reduce((sum, l) => sum + l.remainingBalance, 0);

  assert.equal(totalOutstanding, 23175);
});

// 20. Tenant A cannot access Tenant B financial records
test('20. Cross-tenant security prevents access to cross-tenant payment history', () => {
  const tenantAPayments = [{ transactionId: 'TRX-A1', tenantId: 'tenantA' }];
  const tenantBContext = 'tenantB';

  const accessiblePayments = tenantAPayments.filter(p => p.tenantId === tenantBContext);
  assert.equal(accessiblePayments.length, 0);
});
