const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { updateDraftApplication } = require('../../src/controllers/loanApplicationController');
const LoanApplication = require('../../src/models/LoanApplication');
const LoanEmployment = require('../../src/models/LoanEmployment');
const LoanBanking = require('../../src/models/LoanBanking');

test('Draft Application Edit: updates requestedAmount, duration, and personal info on draft', async () => {
  const originalFindById = LoanApplication.findById;
  const originalEmploymentUpsert = LoanEmployment.findOneAndUpdate;
  const originalBankingUpsert = LoanBanking.findOneAndUpdate;

  const mockApp = {
    _id: new mongoose.Types.ObjectId(),
    applicationId: 'LAPP-1042',
    status: 'Draft',
    fullName: 'Tebogo Shounyane',
    phoneNumber: '0820000000',
    requestedAmount: null,
    requestedDuration: null,
    loanType: 'Personal Loan',
    save: async function () { return this; }
  };

  LoanApplication.findById = async (id) => {
    if (id === mockApp._id.toString()) return mockApp;
    return null;
  };
  LoanEmployment.findOneAndUpdate = async () => ({});
  LoanBanking.findOneAndUpdate = async () => ({});

  const req = {
    params: { id: mockApp._id.toString() },
    body: {
      personal: { phoneNumber: '0831112222', residentialAddress: '123 New Street' },
      loanConfig: { requestedAmount: 5000, requestedDuration: 3, loanType: 'Personal Loan' },
      employment: { monthlyIncome: 25000 },
      banking: { bankName: 'Standard Bank', accountNumber: '123456789' }
    }
  };

  let responseData = null;
  let responseStatus = 200;
  const res = {
    status: (code) => {
      responseStatus = code;
      return res;
    },
    json: (data) => {
      responseData = data;
      return res;
    }
  };

  try {
    await updateDraftApplication(req, res);

    assert.equal(responseStatus, 200);
    assert.equal(responseData.success, true);
    assert.equal(mockApp.phoneNumber, '0831112222');
    assert.equal(mockApp.residentialAddress, '123 New Street');
    assert.equal(mockApp.requestedAmount, 5000);
    assert.equal(mockApp.requestedDuration, 3);
  } finally {
    LoanApplication.findById = originalFindById;
    LoanEmployment.findOneAndUpdate = originalEmploymentUpsert;
    LoanBanking.findOneAndUpdate = originalBankingUpsert;
  }
});

test('Draft Application Edit: blocks editing when application is Approved or Disbursed', async () => {
  const originalFindById = LoanApplication.findById;

  const mockApprovedApp = {
    _id: new mongoose.Types.ObjectId(),
    applicationId: 'LAPP-1043',
    status: 'Approved',
    requestedAmount: 1000,
    requestedDuration: 1,
    save: async function () { return this; }
  };

  LoanApplication.findById = async () => mockApprovedApp;

  const req = {
    params: { id: mockApprovedApp._id.toString() },
    body: {
      loanConfig: { requestedAmount: 2000 }
    }
  };

  let responseData = null;
  let responseStatus = 200;
  const res = {
    status: (code) => {
      responseStatus = code;
      return res;
    },
    json: (data) => {
      responseData = data;
      return res;
    }
  };

  try {
    await updateDraftApplication(req, res);

    assert.equal(responseStatus, 400);
    assert.equal(responseData.success, false);
    assert.ok(responseData.message.includes('Only Draft applications can be edited'));
  } finally {
    LoanApplication.findById = originalFindById;
  }
});

test('Draft Application Edit: returns 404 if application not found', async () => {
  const originalFindById = LoanApplication.findById;
  LoanApplication.findById = async () => null;

  const req = {
    params: { id: new mongoose.Types.ObjectId().toString() },
    body: { loanConfig: { requestedAmount: 1000 } }
  };

  let responseData = null;
  let responseStatus = 200;
  const res = {
    status: (code) => {
      responseStatus = code;
      return res;
    },
    json: (data) => {
      responseData = data;
      return res;
    }
  };

  try {
    await updateDraftApplication(req, res);

    assert.equal(responseStatus, 404);
    assert.equal(responseData.success, false);
    assert.equal(responseData.message, 'Loan application not found');
  } finally {
    LoanApplication.findById = originalFindById;
  }
});

