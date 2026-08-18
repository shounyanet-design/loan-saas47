const test = require('node:test');
const assert = require('node:assert/strict');
const LoanApplication = require('../../src/models/LoanApplication');
const { handleRealPayWebhook } = require('../../src/controllers/realpayWebhookController');

function createMockRes() {
  let mockStatus = 0;
  let mockBody = null;
  return {
    res: {
      status(code) { mockStatus = code; return this; },
      json(data) { mockBody = data; return this; }
    },
    getStatus: () => mockStatus,
    getBody: () => mockBody
  };
}

test('RealPay Webhook Hardening - 1. Empty payload returns 400 validation error', async () => {
  const req = { body: {} };
  const { res, getStatus, getBody } = createMockRes();

  await handleRealPayWebhook(req, res, () => {});

  assert.equal(getStatus(), 400);
  assert.equal(getBody().success, false);
  assert.equal(getBody().code, 'REALPAY_VALIDATION_ERROR');
});

test('RealPay Webhook Hardening - 2. Missing required reference returns 400 error', async () => {
  const req = { body: { statusCode: '00', statusDescription: 'Accepted' } };
  const { res, getStatus, getBody } = createMockRes();

  await handleRealPayWebhook(req, res, () => {});

  assert.equal(getStatus(), 400);
  assert.equal(getBody().success, false);
  assert.equal(getBody().code, 'REALPAY_VALIDATION_ERROR');
  assert.ok(getBody().errors && getBody().errors.length > 0);
});

test('RealPay Webhook Hardening - 3. Missing status code returns 400 error', async () => {
  const req = { body: { clientReference: 'LAPP-1001', mandateId: 'RPM-123' } };
  const { res, getStatus, getBody } = createMockRes();

  await handleRealPayWebhook(req, res, () => {});

  assert.equal(getStatus(), 400);
  assert.equal(getBody().success, false);
  assert.equal(getBody().code, 'REALPAY_VALIDATION_ERROR');
  assert.ok(getBody().errors && getBody().errors.length > 0);
});

test('RealPay Webhook Hardening - 4. Valid success callback updates mandate status', async () => {
  const originalFindOne = LoanApplication.findOne;
  const originalFindOneAndUpdate = LoanApplication.findOneAndUpdate;
  let savedData = null;

  const mockLoan = {
    _id: '507f1f77bcf86cd799439011',
    applicationId: 'LAPP-1001',
    debicheckMandateStatus: '',
    debicheckMandateReference: '',
    realPayMandate: {}
  };

  LoanApplication.findOne = async () => mockLoan;
  LoanApplication.findOneAndUpdate = async (filter, update) => {
    savedData = {
      _id: mockLoan._id,
      applicationId: mockLoan.applicationId,
      debicheckMandateStatus: update.$set.debicheckMandateStatus,
      realPayMandate: {
        mandateId: update.$set['realPayMandate.mandateId'],
        status: update.$set['realPayMandate.status']
      }
    };
    return savedData;
  };

  const req = {
    body: {
      clientReference: 'LAPP-1001',
      mandateId: 'RPM-1001',
      statusCode: '00',
      statusDescription: 'Mandate Accepted Successfully'
    }
  };

  const { res, getStatus, getBody } = createMockRes();

  try {
    await handleRealPayWebhook(req, res, () => {});
    assert.equal(getStatus(), 200);
    assert.equal(getBody().success, true);
    assert.equal(savedData.debicheckMandateStatus, 'ACCEPTED');
    assert.equal(savedData.realPayMandate.mandateId, 'RPM-1001');
  } finally {
    LoanApplication.findOne = originalFindOne;
    LoanApplication.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('RealPay Webhook Hardening - 5. Valid rejected callback updates status to REJECTED', async () => {
  const originalFindOne = LoanApplication.findOne;
  const originalFindOneAndUpdate = LoanApplication.findOneAndUpdate;
  let savedData = null;

  const mockLoan = {
    _id: '507f1f77bcf86cd799439011',
    applicationId: 'LAPP-1002',
    debicheckMandateStatus: '',
    realPayMandate: {}
  };

  LoanApplication.findOne = async () => mockLoan;
  LoanApplication.findOneAndUpdate = async (filter, update) => {
    savedData = {
      _id: mockLoan._id,
      applicationId: mockLoan.applicationId,
      debicheckMandateStatus: update.$set.debicheckMandateStatus,
      realPayMandate: {
        status: update.$set['realPayMandate.status']
      }
    };
    return savedData;
  };

  const req = {
    body: {
      clientReference: 'LAPP-1002',
      mandateId: 'RPM-1002',
      statusCode: 'REJECTED',
      statusDescription: 'Insufficient Funds'
    }
  };

  const { res, getStatus, getBody } = createMockRes();

  try {
    await handleRealPayWebhook(req, res, () => {});
    assert.equal(getStatus(), 200);
    assert.equal(getBody().success, true);
    assert.equal(savedData.debicheckMandateStatus, 'REJECTED');
    assert.equal(savedData.realPayMandate.status, 'REJECTED');
  } finally {
    LoanApplication.findOne = originalFindOne;
    LoanApplication.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('RealPay Webhook Hardening - 6. Unknown reference returns 200 acknowledgement without 500 error', async () => {
  const originalFindOne = LoanApplication.findOne;
  LoanApplication.findOne = async () => null;

  const req = {
    body: {
      clientReference: 'LAPP-UNKNOWN-999',
      mandateId: 'RPM-UNKNOWN-999',
      statusCode: '00',
      statusDescription: 'Accepted'
    }
  };

  const { res, getStatus, getBody } = createMockRes();

  try {
    await handleRealPayWebhook(req, res, () => {});
    assert.equal(getStatus(), 200);
    assert.equal(getBody().success, true);
    assert.ok(getBody().message.includes('matching loan application reference not found'));
  } finally {
    LoanApplication.findOne = originalFindOne;
  }
});

test('RealPay Webhook Hardening - 7. Duplicate callback returns 200 replayed response without duplicate mutation', async () => {
  const originalFindOne = LoanApplication.findOne;
  let saveCount = 0;

  const mockLoan = {
    _id: '507f1f77bcf86cd799439011',
    applicationId: 'LAPP-1003',
    debicheckMandateStatus: 'ACCEPTED',
    realPayMandate: {
      status: 'ACCEPTED',
      statusCode: '00',
      lastWebhookAt: new Date()
    },
    async save() { saveCount++; return this; }
  };

  LoanApplication.findOne = async () => mockLoan;

  const req = {
    body: {
      clientReference: 'LAPP-1003',
      mandateId: 'RPM-1003',
      statusCode: '00',
      statusDescription: 'Mandate Accepted'
    }
  };

  const { res, getStatus, getBody } = createMockRes();

  try {
    await handleRealPayWebhook(req, res, () => {});
    assert.equal(getStatus(), 200);
    assert.equal(getBody().success, true);
    assert.equal(getBody().data.replayed, true);
    assert.equal(saveCount, 0, 'No DB save mutation should occur on duplicate webhook');
  } finally {
    LoanApplication.findOne = originalFindOne;
  }
});
