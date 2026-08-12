const test = require('node:test');
const assert = require('node:assert/strict');

const realpayService = require('../../src/services/realpay/realpayService');
const realpayAuthService = require('../../src/services/realpay/realpayAuth.service');
const debitOrderProvider = require('../../src/services/payments/debitOrderProvider');
const { RealPayConfigurationError } = require('../../src/errors/realpayErrors');

test('RealPay Service - Credential resolution defaults', async () => {
  const creds = await realpayAuthService.getCredentials(null);
  assert.equal(creds.merchantNumber, '23118');
  assert.equal(creds.product, 'ABSADC');
});

test('RealPay Service - Auth token generation and caching', async () => {
  realpayAuthService.clearCache();
  const res1 = await realpayAuthService.getAccessToken(null);
  assert.ok(res1.token);
  assert.ok(res1.token.startsWith('RP_UAT_TOKEN_23118_'));

  const res2 = await realpayAuthService.getAccessToken(null);
  assert.equal(res1.token, res2.token, 'Token should be returned from cache');
});

test('RealPay Service - Payload validation catches missing required fields', () => {
  assert.throws(
    () => realpayService.validatePayload({}),
    (err) => err instanceof RealPayConfigurationError && err.message.includes('clientReference')
  );

  const valid = realpayService.validatePayload({
    clientReference: 'LAPP-1001',
    debtorName: 'John Doe',
    debtorId: '9001015009087',
    debtorAccountNumber: '1234567890',
    debtorBranchNumber: '051001',
    instalmentAmount: 1500
  });
  assert.equal(valid, true);
});

test('RealPay Service - Mandate Initiation mapping', async () => {
  const samplePayload = {
    clientReference: 'LAPP-TEST-001',
    debtorName: 'Test Debtor',
    debtorId: '9001015009087',
    debtorAccountNumber: '1234567890',
    debtorBranchNumber: '051001',
    instalmentAmount: 1200,
    flowType: 'TT1'
  };

  // Mock client HTTP post
  const realpayClient = require('../../src/services/realpay/realpayClient');
  const originalPost = realpayClient.post;
  realpayClient.post = async (path, payload, tenantId, parser) => {
    if (path.includes('/maintain/clients')) {
      return { ClientPostResponse: [{ Successful: [{ RecordNumber: 1 }], Failed: [] }] };
    }
    const mandateItem = payload.MandatePostRequest?.[0] || {};
    assert.equal(mandateItem.ClientNumber, 'LAPP-TEST-001');
    assert.equal(mandateItem.MandateProduct, 'ABSADC');
    assert.equal(mandateItem.InstalmentAmount, 1200);
    const mockData = {
      statusCode: '00',
      statusDescription: 'Mandate Registered Successfully',
      mandateId: 'RPM-TEST-999',
      clientReference: 'LAPP-TEST-001'
    };
    return parser ? parser(mockData) : mockData;
  };

  try {
    const response = await realpayService.initiateMandate(samplePayload, null);
    assert.equal(response.outcome, 'ACCEPTED');
    assert.equal(response.mandateId, 'RPM-TEST-999');
  } finally {
    realpayClient.post = originalPost;
  }
});

test('Debit Order Provider - Provider resolution', async () => {
  const provider = await debitOrderProvider.resolveProviderName(null);
  assert.equal(provider, 'realpay');
});
