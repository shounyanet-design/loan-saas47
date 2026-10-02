const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const RepaymentSchedule = require('../../src/models/RepaymentSchedule');
const ActiveLoan = require('../../src/models/ActiveLoan');
const Loan = require('../../src/models/Loan');
const Borrower = require('../../src/models/Borrower');
const Payment = require('../../src/models/Payment');
const LoanApplication = require('../../src/models/LoanApplication');
const tenantContext = require('../../src/tenancy/tenantContext');

const activeLoanController = require('../../src/controllers/admin/activeLoanController');
const borrowerController = require('../../src/controllers/borrowerController');

describe('Repayment Reference Integrity Remediation Test Suite', () => {
  let mongoServer;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await tenantContext.runAsSystem(async () => {
      await mongoose.connection.dropDatabase();
    });
  });

  async function createFixtures(tenantId = '650000000000000000000001') {
    return tenantContext.runWithTenant(tenantId, async () => {
      const borrower = await Borrower.create({
        fullName: 'Integrity Test Borrower',
        email: `borrower-${Date.now()}-${Math.floor(Math.random()*10000)}@example.com`,
        phoneNumber: '+27820009999',
        password: 'password123',
        tenantId
      });

      const application = await LoanApplication.create({
        applicationId: `LAPP-${Date.now()}-${Math.floor(Math.random()*1000)}`,
        borrowerId: borrower._id,
        fullName: borrower.fullName,
        emailAddress: borrower.email,
        phoneNumber: borrower.phoneNumber,
        idNumber: '9001015009087',
        dateOfBirth: new Date('1990-01-01'),
        residentialAddress: '123 Main Street, Johannesburg',
        requestedAmount: 5000,
        approvedAmount: 5000,
        loanDurationMonths: 3,
        status: 'DISBURSED',
        tenantId
      });

      const activeLoan = await ActiveLoan.create({
        borrowerId: borrower._id,
        borrowerName: borrower.fullName,
        loanApplicationId: application._id,
        loanCode: `P47-TEST-${Date.now()}-${Math.floor(Math.random()*1000)}`,
        approvedAmount: 5000,
        interestRate: 15,
        loanDurationMonths: 3,
        emiAmount: 1800,
        totalPayableAmount: 5400,
        remainingBalance: 5400,
        loanStatus: 'Active',
        tenantId
      });

      return { borrower, application, activeLoan, tenantId };
    });
  }

  it('1. Valid overdue schedule updates correct ActiveLoan status to Overdue', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { activeLoan, borrower } = await createFixtures(tenantId);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);

    let schedule;
    await tenantContext.runWithTenant(tenantId, async () => {
      schedule = await RepaymentSchedule.create({
        loanId: activeLoan._id,
        borrowerId: borrower._id,
        emiNumber: 1,
        dueDate: yesterday,
        amount: 1800,
        status: 'Pending',
        tenantId
      });
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const overdueEmis = await RepaymentSchedule.find({
        status: 'Pending',
        dueDate: { $lt: new Date() }
      }).populate('loanId borrowerId');

      for (const emi of overdueEmis) {
        if (!emi.loanId || !emi.borrowerId) continue;
        emi.status = 'Overdue';
        await emi.save();
        if (emi.loanId.loanStatus === 'Active') {
          await ActiveLoan.findByIdAndUpdate(emi.loanId._id, { loanStatus: 'Overdue' });
        }
      }
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const updatedSchedule = await RepaymentSchedule.findById(schedule._id);
      const updatedActiveLoan = await ActiveLoan.findById(activeLoan._id);

      assert.strictEqual(updatedSchedule.status, 'Overdue');
      assert.strictEqual(updatedActiveLoan.loanStatus, 'Overdue');
    });
  });

  it('2. Legacy Loan collection remains untouched during cron processing', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { activeLoan, borrower } = await createFixtures(tenantId);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await tenantContext.runWithTenant(tenantId, async () => {
      await RepaymentSchedule.create({
        loanId: activeLoan._id,
        borrowerId: borrower._id,
        emiNumber: 1,
        dueDate: yesterday,
        amount: 1800,
        status: 'Pending',
        tenantId
      });
    });

    const legacyLoanCountBefore = await tenantContext.runAsSystem(() => Loan.countDocuments({}));
    assert.strictEqual(legacyLoanCountBefore, 0);

    await tenantContext.runWithTenant(tenantId, async () => {
      const overdueEmis = await RepaymentSchedule.find({
        status: 'Pending',
        dueDate: { $lt: new Date() }
      }).populate('loanId borrowerId');

      for (const emi of overdueEmis) {
        if (!emi.loanId || !emi.borrowerId) continue;
        emi.status = 'Overdue';
        await emi.save();
        if (emi.loanId.loanStatus === 'Active') {
          await ActiveLoan.findByIdAndUpdate(emi.loanId._id, { loanStatus: 'Overdue' });
        }
      }
    });

    const legacyLoanCountAfter = await tenantContext.runAsSystem(() => Loan.countDocuments({}));
    assert.strictEqual(legacyLoanCountAfter, 0, 'Legacy Loan collection must remain empty');
  });

  it('3. Missing loan reference is handled safely without financial mutation', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { borrower } = await createFixtures(tenantId);
    const fakeLoanId = new mongoose.Types.ObjectId();

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 3);

    let schedule;
    await tenantContext.runWithTenant(tenantId, async () => {
      schedule = await RepaymentSchedule.create({
        loanId: fakeLoanId,
        borrowerId: borrower._id,
        emiNumber: 1,
        dueDate: yesterday,
        amount: 1800,
        status: 'Pending',
        tenantId
      });
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const overdueEmis = await RepaymentSchedule.find({
        status: 'Pending',
        dueDate: { $lt: new Date() }
      }).populate('loanId borrowerId');

      for (const emi of overdueEmis) {
        if (!emi.loanId || !emi.borrowerId) {
          continue;
        }
        emi.status = 'Overdue';
        await emi.save();
      }
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const untouchedSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(untouchedSchedule.status, 'Pending');
      assert.strictEqual(untouchedSchedule.amount, 1800);
      assert.strictEqual(untouchedSchedule.amountPaid, 0);
    });
  });

  it('4. Missing borrower reference is handled safely without financial mutation', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { activeLoan } = await createFixtures(tenantId);
    const fakeBorrowerId = new mongoose.Types.ObjectId();

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 3);

    let schedule;
    await tenantContext.runWithTenant(tenantId, async () => {
      schedule = await RepaymentSchedule.create({
        loanId: activeLoan._id,
        borrowerId: fakeBorrowerId,
        emiNumber: 1,
        dueDate: yesterday,
        amount: 1800,
        status: 'Pending',
        tenantId
      });
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const overdueEmis = await RepaymentSchedule.find({
        status: 'Pending',
        dueDate: { $lt: new Date() }
      }).populate('loanId borrowerId');

      for (const emi of overdueEmis) {
        if (!emi.loanId || !emi.borrowerId) {
          continue;
        }
        emi.status = 'Overdue';
        await emi.save();
      }
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const untouchedSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(untouchedSchedule.status, 'Pending');
    });
  });

  it('5. Tenant mismatch causes populate to fail safely and skip financial mutation', async () => {
    const tenantA = new mongoose.Types.ObjectId().toString();
    const tenantB = new mongoose.Types.ObjectId().toString();

    const { activeLoan: loanA, borrower: borrowerA } = await createFixtures(tenantA);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);

    let scheduleB;
    await tenantContext.runWithTenant(tenantB, async () => {
      scheduleB = await RepaymentSchedule.create({
        loanId: loanA._id,
        borrowerId: borrowerA._id,
        emiNumber: 1,
        dueDate: yesterday,
        amount: 1800,
        status: 'Pending',
        tenantId: tenantB
      });
    });

    await tenantContext.runWithTenant(tenantB, async () => {
      const overdueEmis = await RepaymentSchedule.find({
        status: 'Pending',
        dueDate: { $lt: new Date() }
      }).populate('loanId borrowerId');

      for (const emi of overdueEmis) {
        if (!emi.loanId || !emi.borrowerId) {
          continue;
        }
        emi.status = 'Overdue';
        await emi.save();
      }
    });

    await tenantContext.runWithTenant(tenantB, async () => {
      const untouchedSchedule = await RepaymentSchedule.findById(scheduleB._id);
      assert.strictEqual(untouchedSchedule.status, 'Pending');
    });
  });

  it('6. Soft-deleted loan (isDeleted: true) is handled safely', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { activeLoan, borrower } = await createFixtures(tenantId);

    await tenantContext.runWithTenant(tenantId, async () => {
      activeLoan.isDeleted = true;
      await activeLoan.save();
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);

    let schedule;
    await tenantContext.runWithTenant(tenantId, async () => {
      schedule = await RepaymentSchedule.create({
        loanId: activeLoan._id,
        borrowerId: borrower._id,
        emiNumber: 1,
        dueDate: yesterday,
        amount: 1800,
        status: 'Pending',
        tenantId
      });
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const overdueEmis = await RepaymentSchedule.find({
        status: 'Pending',
        dueDate: { $lt: new Date() }
      }).populate('loanId borrowerId');

      for (const emi of overdueEmis) {
        if (!emi.loanId || !emi.borrowerId || emi.loanId.isDeleted) continue;
        emi.status = 'Overdue';
        await emi.save();
      }
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const checkSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(checkSchedule.status, 'Pending');
    });
  });

  it('7. Existing payment history prevents hard deletion of ActiveLoan (returns 400)', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { activeLoan, borrower } = await createFixtures(tenantId);

    await tenantContext.runWithTenant(tenantId, async () => {
      activeLoan.loanStatus = 'Closed';
      await activeLoan.save();

      await Payment.create({
        borrowerId: borrower._id,
        borrowerName: borrower.fullName,
        loanId: activeLoan._id,
        loanCode: activeLoan.loanCode,
        transactionId: `TXN-${Date.now()}`,
        paymentAmount: 1800,
        paymentDate: new Date(),
        paymentMethod: 'EFT',
        paymentStatus: 'Verified',
        tenantId
      });
    });

    let resCode, resMsg;
    const req = { params: { id: activeLoan._id.toString() }, tenantId, user: { role: 'admin' } };
    const res = {
      status(code) { resCode = code; return this; },
      json(data) { resMsg = data.message; return this; }
    };

    await tenantContext.runWithTenant(tenantId, async () => {
      await activeLoanController.deleteLoan(req, res);
    });

    assert.strictEqual(resCode, 400);
    assert.match(resMsg, /Cannot hard-delete loan with existing payment transaction history/i);

    await tenantContext.runWithTenant(tenantId, async () => {
      const loanStillExists = await ActiveLoan.findById(activeLoan._id);
      assert.notStrictEqual(loanStillExists, null);
    });
  });

  it('8. Borrower with active loan cannot be hard-deleted (returns 400)', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { borrower } = await createFixtures(tenantId);

    let resCode, resMsg;
    const req = { params: { id: borrower._id.toString() }, tenantId, user: { role: 'admin' } };
    const res = {
      status(code) { resCode = code; return this; },
      json(data) { resMsg = data.message; return this; }
    };

    await tenantContext.runWithTenant(tenantId, async () => {
      await borrowerController.deleteBorrower(req, res);
    });

    assert.strictEqual(resCode, 400);
    assert.match(resMsg, /Cannot delete borrower with active or existing loan records/i);

    await tenantContext.runWithTenant(tenantId, async () => {
      const borrowerStillExists = await Borrower.findById(borrower._id);
      assert.notStrictEqual(borrowerStillExists, null);
    });
  });

  it('9. Repeated cron invocation is idempotent', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { activeLoan, borrower } = await createFixtures(tenantId);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);

    let schedule;
    await tenantContext.runWithTenant(tenantId, async () => {
      schedule = await RepaymentSchedule.create({
        loanId: activeLoan._id,
        borrowerId: borrower._id,
        emiNumber: 1,
        dueDate: yesterday,
        amount: 1800,
        status: 'Pending',
        tenantId
      });
    });

    const runCron = async () => {
      await tenantContext.runWithTenant(tenantId, async () => {
        const overdueEmis = await RepaymentSchedule.find({
          status: 'Pending',
          dueDate: { $lt: new Date() }
        }).populate('loanId borrowerId');

        for (const emi of overdueEmis) {
          if (!emi.loanId || !emi.borrowerId) continue;
          emi.status = 'Overdue';
          await emi.save();
          if (emi.loanId.loanStatus === 'Active') {
            await ActiveLoan.findByIdAndUpdate(emi.loanId._id, { loanStatus: 'Overdue' });
          }
        }
      });
    };

    // Run 1
    await runCron();
    let stateAfterRun1, schedAfterRun1;
    await tenantContext.runWithTenant(tenantId, async () => {
      stateAfterRun1 = await ActiveLoan.findById(activeLoan._id);
      schedAfterRun1 = await RepaymentSchedule.findById(schedule._id);
    });

    // Run 2
    await runCron();
    let stateAfterRun2, schedAfterRun2;
    await tenantContext.runWithTenant(tenantId, async () => {
      stateAfterRun2 = await ActiveLoan.findById(activeLoan._id);
      schedAfterRun2 = await RepaymentSchedule.findById(schedule._id);
    });

    assert.strictEqual(schedAfterRun1.status, 'Overdue');
    assert.strictEqual(schedAfterRun2.status, 'Overdue');
    assert.strictEqual(stateAfterRun1.loanStatus, 'Overdue');
    assert.strictEqual(stateAfterRun2.loanStatus, 'Overdue');
    assert.strictEqual(stateAfterRun1.remainingBalance, stateAfterRun2.remainingBalance);
  });

  it('10. Unresolved schedule causes zero financial mutation', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { borrower } = await createFixtures(tenantId);
    const fakeLoanId = new mongoose.Types.ObjectId();

    let schedule;
    await tenantContext.runWithTenant(tenantId, async () => {
      schedule = await RepaymentSchedule.create({
        loanId: fakeLoanId,
        borrowerId: borrower._id,
        emiNumber: 1,
        dueDate: new Date('2025-01-01'),
        amount: 2500,
        amountPaid: 0,
        status: 'Pending',
        tenantId
      });
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const overdueEmis = await RepaymentSchedule.find({
        status: 'Pending',
        dueDate: { $lt: new Date() }
      }).populate('loanId borrowerId');

      for (const emi of overdueEmis) {
        if (!emi.loanId || !emi.borrowerId) continue;
        emi.status = 'Overdue';
        await emi.save();
      }
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const checkSchedule = await RepaymentSchedule.findById(schedule._id);
      assert.strictEqual(checkSchedule.amount, 2500);
      assert.strictEqual(checkSchedule.amountPaid, 0);
      assert.strictEqual(checkSchedule.penaltyAmount, 0);
      assert.strictEqual(checkSchedule.status, 'Pending');
    });
  });

  it('11. No payment or schedule history is deleted by remediation', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { activeLoan, borrower } = await createFixtures(tenantId);

    let schedule, payment;
    await tenantContext.runWithTenant(tenantId, async () => {
      schedule = await RepaymentSchedule.create({
        loanId: activeLoan._id,
        borrowerId: borrower._id,
        emiNumber: 1,
        dueDate: new Date(),
        amount: 1800,
        status: 'Paid',
        tenantId
      });

      payment = await Payment.create({
        borrowerId: borrower._id,
        borrowerName: borrower.fullName,
        loanId: activeLoan._id,
        loanCode: activeLoan.loanCode,
        repaymentScheduleId: schedule._id,
        transactionId: `TXN-${Date.now()}`,
        paymentAmount: 1800,
        paymentDate: new Date(),
        paymentMethod: 'Bank Transfer',
        paymentStatus: 'Verified',
        tenantId
      });
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const schedCheck = await RepaymentSchedule.findById(schedule._id);
      const payCheck = await Payment.findById(payment._id);

      assert.notStrictEqual(schedCheck, null);
      assert.notStrictEqual(payCheck, null);
      assert.strictEqual(schedCheck.status, 'Paid');
      assert.strictEqual(payCheck.paymentStatus, 'Verified');
    });
  });

  it('12. Pending EMI blocks unsafe loan deletion (returns 400)', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { activeLoan, borrower } = await createFixtures(tenantId);

    await tenantContext.runWithTenant(tenantId, async () => {
      activeLoan.loanStatus = 'Closed';
      await activeLoan.save();

      await RepaymentSchedule.create({
        loanId: activeLoan._id,
        borrowerId: borrower._id,
        emiNumber: 1,
        dueDate: new Date(),
        amount: 1800,
        status: 'Pending',
        tenantId
      });
    });

    let resCode, resMsg;
    const req = { params: { id: activeLoan._id.toString() }, tenantId, user: { role: 'admin' } };
    const res = {
      status(code) { resCode = code; return this; },
      json(data) { resMsg = data.message; return this; }
    };

    await tenantContext.runWithTenant(tenantId, async () => {
      await activeLoanController.deleteLoan(req, res);
    });

    assert.strictEqual(resCode, 400);
    assert.match(resMsg, /Cannot hard-delete loan with existing repayment schedule history/i);
  });

  it('13. Reversed payment history blocks unsafe loan deletion (returns 400)', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { activeLoan, borrower } = await createFixtures(tenantId);

    await tenantContext.runWithTenant(tenantId, async () => {
      activeLoan.loanStatus = 'Closed';
      await activeLoan.save();

      await Payment.create({
        borrowerId: borrower._id,
        borrowerName: borrower.fullName,
        loanId: activeLoan._id,
        loanCode: activeLoan.loanCode,
        transactionId: `TXN-REV-${Date.now()}`,
        paymentAmount: 1800,
        paymentDate: new Date(),
        paymentMethod: 'Bank Transfer',
        paymentStatus: 'Reversed',
        tenantId
      });
    });

    let resCode, resMsg;
    const req = { params: { id: activeLoan._id.toString() }, tenantId, user: { role: 'admin' } };
    const res = {
      status(code) { resCode = code; return this; },
      json(data) { resMsg = data.message; return this; }
    };

    await tenantContext.runWithTenant(tenantId, async () => {
      await activeLoanController.deleteLoan(req, res);
    });

    assert.strictEqual(resCode, 400);
    assert.match(resMsg, /Cannot hard-delete loan with existing payment transaction history/i);
  });

  it('14. Cross-tenant payment history blocks unsafe loan deletion (returns 400)', async () => {
    const tenantA = new mongoose.Types.ObjectId().toString();
    const tenantB = new mongoose.Types.ObjectId().toString();
    const { activeLoan: loanA, borrower: borrowerA } = await createFixtures(tenantA);

    await tenantContext.runWithTenant(tenantA, async () => {
      loanA.loanStatus = 'Closed';
      await loanA.save();
    });

    // Payment created under tenantB context referencing loanA
    await tenantContext.runWithTenant(tenantB, async () => {
      await Payment.create({
        borrowerId: borrowerA._id,
        borrowerName: borrowerA.fullName,
        loanId: loanA._id,
        loanCode: loanA.loanCode,
        transactionId: `TXN-CROSS-${Date.now()}`,
        paymentAmount: 1800,
        paymentDate: new Date(),
        paymentMethod: 'Bank Transfer',
        paymentStatus: 'Verified',
        tenantId: tenantB
      });
    });

    let resCode, resMsg;
    const req = { params: { id: loanA._id.toString() }, tenantId: tenantA, user: { role: 'admin' } };
    const res = {
      status(code) { resCode = code; return this; },
      json(data) { resMsg = data.message; return this; }
    };

    await tenantContext.runWithTenant(tenantA, async () => {
      await activeLoanController.deleteLoan(req, res);
    });

    assert.strictEqual(resCode, 400);
    assert.match(resMsg, /Cannot hard-delete loan with existing payment transaction history/i);
  });
});
