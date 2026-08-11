const test = require('node:test');
const assert = require('node:assert/strict');
const LoanApplication = require('../../src/models/LoanApplication');

test('RealPay Webhook - Handles callback safely without matching loan', async () => {
  const reqPayload = {
    mandateId: 'RPM-UNKNOWN-999',
    clientReference: 'LAPP-NONEXISTENT',
    statusCode: '00',
    statusDescription: 'Mandate Active'
  };

  // Mock LoanApplication.findOne for isolated unit test environment
  const originalFindOne = LoanApplication.findOne;
  LoanApplication.findOne = async () => null;

  const { handleRealPayWebhook } = require('../../src/controllers/realpayWebhookController');

  let mockStatus = 0;
  let mockBody = null;

  const req = { body: reqPayload };
  const res = {
    status(code) { mockStatus = code; return this; },
    json(data) { mockBody = data; return this; }
  };

  try {
    await handleRealPayWebhook(req, res, () => {});
    assert.equal(mockStatus, 200);
    assert.equal(mockBody.success, true);
    assert.equal(mockBody.data.mandateId, 'RPM-UNKNOWN-999');
  } finally {
    LoanApplication.findOne = originalFindOne;
  }
});
