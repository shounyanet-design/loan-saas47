process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_for_unit_tests_point47_32chars';
process.env.CREDENTIAL_ENCRYPTION_KEY = '1234567890123456789012345678901234567890123456789012345678901234';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Borrower = require('../../src/models/Borrower');
const ActiveLoan = require('../../src/models/ActiveLoan');
const RepaymentSchedule = require('../../src/models/RepaymentSchedule');
const BorrowerAlert = require('../../src/models/BorrowerAlert');
const LoanActivity = require('../../src/models/LoanActivity');
const LoanApplication = require('../../src/models/LoanApplication');
const SystemSettings = require('../../src/models/SystemSettings');
const Tenant = require('../../src/models/Tenant');
const PlatformAuditLog = require('../../src/modules/platform/models/PlatformAuditLog');

const { getBorrowerDashboard } = require('../../src/controllers/borrower/dashboardController');
const { disburseLoan } = require('../../src/modules/disbursement/services/disbursement.service');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function makeQuery(result) {
  const q = {
    sort() { return q; },
    limit() { return q; },
    lean() { return Promise.resolve(result); },
    session() { return Promise.resolve(result); },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    catch(reject) { return Promise.resolve(result).catch(reject); }
  };
  return q;
}

function idsMatch(filterVal, targetId) {
  if (!filterVal) return false;
  if (Array.isArray(filterVal.$in)) {
    return filterVal.$in.map(String).includes(String(targetId));
  }
  return String(filterVal) === String(targetId);
}

test('Borrower Dashboard - 1. Finds active loan stored under User._id as well as Borrower._id', async () => {
  const userId = new mongoose.Types.ObjectId();
  const borrowerProfileId = new mongoose.Types.ObjectId();
  const loanId = new mongoose.Types.ObjectId();
  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const orig = {
    borrowerFindOne: Borrower.findOne,
    activeLoanFindOne: ActiveLoan.findOne,
    scheduleFindOne: RepaymentSchedule.findOne,
    alertFind: BorrowerAlert.find,
    activityFind: LoanActivity.find
  };

  let capturedLoanQuery = null;
  let capturedAlertQuery = null;
  let capturedActivityQuery = null;

  Borrower.findOne = async () => ({ _id: borrowerProfileId, userId });
  ActiveLoan.findOne = (query) => {
    capturedLoanQuery = query;
    const matched = idsMatch(query.borrowerId, userId)
      ? {
          _id: loanId,
          borrowerId: userId,
          loanCode: 'P47-178000',
          approvedAmount: 1000,
          totalPayableAmount: 1256.5,
          remainingBalance: 1256.5,
          loanType: 'Personal Loan',
          interestRate: 36,
          loanStatus: 'Active',
          loanDurationMonths: 1,
          emiAmount: 1256.5
        }
      : null;
    return makeQuery(matched);
  };
  RepaymentSchedule.findOne = () => makeQuery({
    loanId,
    amount: 1256.5,
    dueDate,
    emiNumber: 1,
    status: 'Pending'
  });
  BorrowerAlert.find = (query) => {
    capturedAlertQuery = query;
    return makeQuery(idsMatch(query.borrowerId, borrowerProfileId) ? [{ _id: 'a1', title: 'Agreement Signed' }] : []);
  };
  LoanActivity.find = (query) => {
    capturedActivityQuery = query;
    return makeQuery(idsMatch(query.borrowerId, borrowerProfileId) ? [{ _id: 'act1', title: 'Disbursed' }] : []);
  };

  try {
    const req = { user: { _id: userId } };
    const res = makeRes();
    await getBorrowerDashboard(req, res, (err) => { if (err) throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    const data = res.body.data;
    assert.equal(data.loanStatus, 'Active');
    assert.equal(data.loanOverview.approvedAmount, 1000);
    assert.equal(data.loanOverview.totalPayable, 1256.5);
    assert.equal(data.remainingBalance.amount, 1256.5);
    assert.equal(data.nextEmi.amount, 1256.5);
    assert.equal(data.repaymentProgress, 0);
    assert.equal(data.alerts.length, 1);
    assert.equal(data.recentActivities.length, 1);

    assert.ok(idsMatch(capturedLoanQuery.borrowerId, borrowerProfileId));
    assert.ok(idsMatch(capturedLoanQuery.borrowerId, userId));
    assert.equal(capturedLoanQuery.isDeleted, false);
    assert.ok(idsMatch(capturedAlertQuery.borrowerId, userId));
    assert.ok(idsMatch(capturedActivityQuery.borrowerId, userId));
  } finally {
    Borrower.findOne = orig.borrowerFindOne;
    ActiveLoan.findOne = orig.activeLoanFindOne;
    RepaymentSchedule.findOne = orig.scheduleFindOne;
    BorrowerAlert.find = orig.alertFind;
    LoanActivity.find = orig.activityFind;
  }
});

test('Borrower Dashboard - 2. Still returns User-linked active loan/alerts if Borrower profile is missing, and falls back to embedded schedule', async () => {
  const userId = new mongoose.Types.ObjectId();
  const loanId = new mongoose.Types.ObjectId();
  const dueDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

  const orig = {
    borrowerFindOne: Borrower.findOne,
    activeLoanFindOne: ActiveLoan.findOne,
    scheduleFindOne: RepaymentSchedule.findOne,
    alertFind: BorrowerAlert.find,
    activityFind: LoanActivity.find
  };

  Borrower.findOne = async () => null;
  ActiveLoan.findOne = (query) => makeQuery(
    idsMatch(query.borrowerId, userId)
      ? {
          _id: loanId,
          borrowerId: userId,
          loanCode: 'P47-999',
          approvedAmount: 2000,
          totalPayableAmount: 2400,
          remainingBalance: 1200,
          loanType: 'Personal Loan',
          interestRate: 24,
          loanStatus: 'Active',
          loanDurationMonths: 2,
          emiAmount: 1200,
          repaymentSchedule: [
            { installmentNumber: 1, dueDate, emiAmount: 1200, paymentStatus: 'Pending' }
          ]
        }
      : null
  );
  RepaymentSchedule.findOne = () => makeQuery(null);
  BorrowerAlert.find = () => makeQuery([{ _id: 'a2', title: 'Reminder' }]);
  LoanActivity.find = () => makeQuery([{ _id: 'act2', title: 'Paid EMI 1' }]);

  try {
    const req = { user: { _id: userId } };
    const res = makeRes();
    await getBorrowerDashboard(req, res, (err) => { if (err) throw err; });

    assert.equal(res.statusCode, 200);
    const data = res.body.data;
    assert.equal(data.loanStatus, 'Active');
    assert.equal(data.repaymentProgress, 50);
    assert.equal(data.nextEmi.amount, 1200);
    assert.equal(data.nextEmi.emiNumber, 1);
    assert.equal(data.alerts.length, 1);
    assert.equal(data.recentActivities.length, 1);
  } finally {
    Borrower.findOne = orig.borrowerFindOne;
    ActiveLoan.findOne = orig.activeLoanFindOne;
    RepaymentSchedule.findOne = orig.scheduleFindOne;
    BorrowerAlert.find = orig.alertFind;
    LoanActivity.find = orig.activityFind;
  }
});

test('Disbursement Service - 3. Stores Borrower._id (not User._id) on ActiveLoan and RepaymentSchedule when disbursing', async () => {
  const tenantId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const borrowerProfileId = new mongoose.Types.ObjectId();
  const applicationId = new mongoose.Types.ObjectId();

  const orig = {
    startSession: mongoose.startSession,
    appFindOne: LoanApplication.findOne,
    activeLoanFindOne: ActiveLoan.findOne,
    activeLoanCreate: ActiveLoan.create,
    scheduleInsertMany: RepaymentSchedule.insertMany,
    borrowerFindOne: Borrower.findOne,
    settingsFindOne: SystemSettings.findOne,
    tenantFindById: Tenant.findById,
    auditCreate: PlatformAuditLog.create
  };

  let createdLoanPayload = null;
  let insertedSchedules = null;

  mongoose.startSession = async () => ({
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    endSession() {}
  });

  const mockApplication = {
    _id: applicationId,
    applicationId: 'LAPP-1042',
    tenantId,
    borrowerId: userId, // LoanApplication stores User._id
    fullName: 'Tebogo Shounyane',
    emailAddress: 'shounyanet@gmail.com',
    phoneNumber: '0839858917',
    loanType: 'Personal Loan',
    approvedAmount: 1000,
    requestedAmount: 1000,
    requestedDuration: 1,
    interestRate: 36,
    disbursementStatus: 'READY_FOR_DISBURSEMENT',
    agreementStatus: 'SIGNED',
    debicheckMandateStatus: 'ACCEPTED',
    agreementFinancialSnapshot: {
      principalAmount: 1000,
      durationMonths: 1,
      annualInterestRate: 36,
      totalRepaymentAmount: 1256.5,
      monthlyInstallmentAmount: 1256.5,
      debi24ServiceFeeRate: 2.5
    },
    agreementCreditProviderSnapshot: {
      legalName: 'Point.47 Finance Pty Ltd'
    },
    async save() { return this; }
  };

  LoanApplication.findOne = () => makeQuery(mockApplication);
  ActiveLoan.findOne = () => makeQuery(null);
  SystemSettings.findOne = () => makeQuery({ debi24ServiceFeeRate: 2.5, loanProducts: [] });
  Tenant.findById = () => makeQuery(null);
  Borrower.findOne = () => makeQuery({ _id: borrowerProfileId, userId });

  ActiveLoan.create = async (docs) => {
    createdLoanPayload = docs[0];
    return [{ _id: new mongoose.Types.ObjectId(), ...docs[0] }];
  };
  RepaymentSchedule.insertMany = async (entries) => {
    insertedSchedules = entries;
    return entries;
  };
  PlatformAuditLog.create = async (docs) => docs;

  try {
    const result = await disburseLoan(String(applicationId), { tenantId, userId: 'admin123' });

    assert.equal(result.existing, false);
    assert.ok(createdLoanPayload, 'ActiveLoan payload must be created');
    assert.equal(String(createdLoanPayload.borrowerId), String(borrowerProfileId));
    assert.notEqual(String(createdLoanPayload.borrowerId), String(userId));

    assert.ok(Array.isArray(insertedSchedules) && insertedSchedules.length === 1);
    assert.equal(String(insertedSchedules[0].borrowerId), String(borrowerProfileId));
  } finally {
    mongoose.startSession = orig.startSession;
    LoanApplication.findOne = orig.appFindOne;
    ActiveLoan.findOne = orig.activeLoanFindOne;
    ActiveLoan.create = orig.activeLoanCreate;
    RepaymentSchedule.insertMany = orig.scheduleInsertMany;
    Borrower.findOne = orig.borrowerFindOne;
    SystemSettings.findOne = orig.settingsFindOne;
    Tenant.findById = orig.tenantFindById;
    PlatformAuditLog.create = orig.auditCreate;
  }
});

