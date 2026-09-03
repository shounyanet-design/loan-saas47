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

  const res2 = await realpayAuthService.getAccessToken(null);
  assert.equal(res1.token, res2.token, 'Token should be returned from cache');
  realpayAuthService.clearCache();
});

test('RealPay Auth - Exact Swagger OAuth2 URL, method and headers', async () => {
  realpayAuthService.clearCache();
  const originalHttpClient = realpayAuthService.httpClient;
  const originalGetCredentials = realpayAuthService.getCredentials;
  let capturedUrl = '';
  let capturedHeaders = {};
  let capturedBody = '';

  realpayAuthService.getCredentials = async () => ({
    clientId: 'bg6YToNu2Is5STnwZZmB5g..',
    clientSecret: 'bvSdgWCQw0OiAVSjB0XDgA..',
    merchantNumber: '23118',
    baseUrl: 'https://uat.realpaycollect.com:4448',
    product: 'ABSADC',
    environment: 'UAT',
    timeout: 5000
  });

  realpayAuthService.httpClient = {
    post: async (url, body, config) => {
      capturedUrl = url;
      capturedHeaders = config.headers;
      capturedBody = body.toString();
      return {
        data: {
          access_token: 'MOCK_SWAGGER_TOKEN_123',
          token_type: 'bearer',
          expires_in: 3600
        }
      };
    }
  };

  try {
    const res = await realpayAuthService.getAccessToken(null);
    assert.equal(res.token, 'MOCK_SWAGGER_TOKEN_123');
    assert.ok(capturedUrl.endsWith('/rpi/rpws/oauth/token'), 'Must call /rpi/rpws/oauth/token');
    assert.equal(capturedHeaders['Content-Type'], 'application/x-www-form-urlencoded');
    assert.ok(capturedHeaders['Authorization'].startsWith('Basic '), 'Must send Basic Auth header');
    assert.ok(capturedBody.includes('grant_type=client_credentials'), 'Must send grant_type form parameter');
  } finally {
    realpayAuthService.httpClient = originalHttpClient;
    realpayAuthService.getCredentials = originalGetCredentials;
    realpayAuthService.clearCache();
  }
});

test('RealPay Auth - HTTP 404 endpoint error mapping', async () => {
  realpayAuthService.clearCache();
  const originalHttpClient = realpayAuthService.httpClient;
  const originalGetCredentials = realpayAuthService.getCredentials;

  realpayAuthService.getCredentials = async () => ({
    clientId: 'bg6YToNu2Is5STnwZZmB5g..',
    clientSecret: 'bvSdgWCQw0OiAVSjB0XDgA..',
    merchantNumber: '23118',
    baseUrl: 'https://uat.realpaycollect.com:4448',
    product: 'ABSADC',
    environment: 'UAT',
    timeout: 5000
  });

  realpayAuthService.httpClient = {
    post: async () => {
      const err = new Error('Request failed with status code 404');
      err.response = { status: 404 };
      throw err;
    }
  };

  try {
    await assert.rejects(
      () => realpayAuthService.getAccessToken(null),
      (err) => err.code === 'REALPAY_AUTH_ERROR' && err.message.includes('404')
    );
  } finally {
    realpayAuthService.httpClient = originalHttpClient;
    realpayAuthService.getCredentials = originalGetCredentials;
    realpayAuthService.clearCache();
  }
});

test('RealPay Auth - HTTP 401 invalid credentials error mapping', async () => {
  realpayAuthService.clearCache();
  const originalHttpClient = realpayAuthService.httpClient;
  const originalGetCredentials = realpayAuthService.getCredentials;

  realpayAuthService.getCredentials = async () => ({
    clientId: 'bg6YToNu2Is5STnwZZmB5g..',
    clientSecret: 'bvSdgWCQw0OiAVSjB0XDgA..',
    merchantNumber: '23118',
    baseUrl: 'https://uat.realpaycollect.com:4448',
    product: 'ABSADC',
    environment: 'UAT',
    timeout: 5000
  });

  realpayAuthService.httpClient = {
    post: async () => {
      const err = new Error('Request failed with status code 401');
      err.response = { status: 401 };
      throw err;
    }
  };

  try {
    await assert.rejects(
      () => realpayAuthService.getAccessToken(null),
      (err) => err.code === 'REALPAY_AUTH_ERROR' && err.message.includes('Invalid RealPay client credentials')
    );
  } finally {
    realpayAuthService.httpClient = originalHttpClient;
    realpayAuthService.getCredentials = originalGetCredentials;
    realpayAuthService.clearCache();
  }
});

test('RealPay Auth Gateway Selection - 1. environment=UAT + mode=production -> /rpi/rpws/oauth/token', async () => {
  realpayAuthService.clearCache();
  const originalHttpClient = realpayAuthService.httpClient;
  const originalGetCredentials = realpayAuthService.getCredentials;
  let capturedUrl = '';

  realpayAuthService.getCredentials = async () => ({
    clientId: 'test_client_id',
    clientSecret: 'test_client_secret',
    merchantNumber: '23118',
    baseUrl: 'https://uat.realpaycollect.com:4448',
    product: 'ABSADC',
    environment: 'UAT',
    mode: 'production',
    timeout: 5000
  });

  realpayAuthService.httpClient = {
    post: async (url) => {
      capturedUrl = url;
      return { data: { access_token: 'MOCK_TOKEN' } };
    }
  };

  try {
    await realpayAuthService.getAccessToken(null);
    assert.ok(capturedUrl.endsWith('/rpi/rpws/oauth/token'), `Expected /rpi/rpws/oauth/token but got ${capturedUrl}`);
  } finally {
    realpayAuthService.httpClient = originalHttpClient;
    realpayAuthService.getCredentials = originalGetCredentials;
    realpayAuthService.clearCache();
  }
});

test('RealPay Auth Gateway Selection - 2. environment=UAT + mode=uat -> /rpi/rpws/oauth/token', async () => {
  realpayAuthService.clearCache();
  const originalHttpClient = realpayAuthService.httpClient;
  const originalGetCredentials = realpayAuthService.getCredentials;
  let capturedUrl = '';

  realpayAuthService.getCredentials = async () => ({
    clientId: 'test_client_id',
    clientSecret: 'test_client_secret',
    merchantNumber: '23118',
    baseUrl: 'https://uat.realpaycollect.com:4448',
    product: 'ABSADC',
    environment: 'UAT',
    mode: 'uat',
    timeout: 5000
  });

  realpayAuthService.httpClient = {
    post: async (url) => {
      capturedUrl = url;
      return { data: { access_token: 'MOCK_TOKEN' } };
    }
  };

  try {
    await realpayAuthService.getAccessToken(null);
    assert.ok(capturedUrl.endsWith('/rpi/rpws/oauth/token'), `Expected /rpi/rpws/oauth/token but got ${capturedUrl}`);
  } finally {
    realpayAuthService.httpClient = originalHttpClient;
    realpayAuthService.getCredentials = originalGetCredentials;
    realpayAuthService.clearCache();
  }
});

test('RealPay Auth Gateway Selection - 3. environment=PRODUCTION + mode=production -> /rpp/rpws/oauth/token', async () => {
  realpayAuthService.clearCache();
  const originalHttpClient = realpayAuthService.httpClient;
  const originalGetCredentials = realpayAuthService.getCredentials;
  let capturedUrl = '';

  realpayAuthService.getCredentials = async () => ({
    clientId: 'test_client_id',
    clientSecret: 'test_client_secret',
    merchantNumber: '23118',
    baseUrl: 'https://realpaycollect.com:4448',
    product: 'ABSADC',
    environment: 'PRODUCTION',
    mode: 'production',
    timeout: 5000
  });

  realpayAuthService.httpClient = {
    post: async (url) => {
      capturedUrl = url;
      return { data: { access_token: 'MOCK_TOKEN' } };
    }
  };

  try {
    await realpayAuthService.getAccessToken(null);
    assert.ok(capturedUrl.endsWith('/rpp/rpws/oauth/token'), `Expected /rpp/rpws/oauth/token but got ${capturedUrl}`);
  } finally {
    realpayAuthService.httpClient = originalHttpClient;
    realpayAuthService.getCredentials = originalGetCredentials;
    realpayAuthService.clearCache();
  }
});

test('RealPay Auth Gateway Selection - 4. environment=PRODUCTION + mode=uat -> /rpp/rpws/oauth/token', async () => {
  realpayAuthService.clearCache();
  const originalHttpClient = realpayAuthService.httpClient;
  const originalGetCredentials = realpayAuthService.getCredentials;
  let capturedUrl = '';

  realpayAuthService.getCredentials = async () => ({
    clientId: 'test_client_id',
    clientSecret: 'test_client_secret',
    merchantNumber: '23118',
    baseUrl: 'https://realpaycollect.com:4448',
    product: 'ABSADC',
    environment: 'PRODUCTION',
    mode: 'uat',
    timeout: 5000
  });

  realpayAuthService.httpClient = {
    post: async (url) => {
      capturedUrl = url;
      return { data: { access_token: 'MOCK_TOKEN' } };
    }
  };

  try {
    await realpayAuthService.getAccessToken(null);
    assert.ok(capturedUrl.endsWith('/rpp/rpws/oauth/token'), `Expected /rpp/rpws/oauth/token but got ${capturedUrl}`);
  } finally {
    realpayAuthService.httpClient = originalHttpClient;
    realpayAuthService.getCredentials = originalGetCredentials;
    realpayAuthService.clearCache();
  }
});

test('RealPay Auth Gateway Selection - 5. environment missing + mode=production -> /rpp/rpws/oauth/token', async () => {
  realpayAuthService.clearCache();
  const originalHttpClient = realpayAuthService.httpClient;
  const originalGetCredentials = realpayAuthService.getCredentials;
  let capturedUrl = '';

  realpayAuthService.getCredentials = async () => ({
    clientId: 'test_client_id',
    clientSecret: 'test_client_secret',
    merchantNumber: '23118',
    baseUrl: 'https://realpaycollect.com:4448',
    product: 'ABSADC',
    environment: '',
    mode: 'production',
    timeout: 5000
  });

  realpayAuthService.httpClient = {
    post: async (url) => {
      capturedUrl = url;
      return { data: { access_token: 'MOCK_TOKEN' } };
    }
  };

  try {
    await realpayAuthService.getAccessToken(null);
    assert.ok(capturedUrl.endsWith('/rpp/rpws/oauth/token'), `Expected /rpp/rpws/oauth/token but got ${capturedUrl}`);
  } finally {
    realpayAuthService.httpClient = originalHttpClient;
    realpayAuthService.getCredentials = originalGetCredentials;
    realpayAuthService.clearCache();
  }
});

test('RealPay Auth Gateway Selection - 6. environment missing + mode=uat -> /rpi/rpws/oauth/token', async () => {
  realpayAuthService.clearCache();
  const originalHttpClient = realpayAuthService.httpClient;
  const originalGetCredentials = realpayAuthService.getCredentials;
  let capturedUrl = '';

  realpayAuthService.getCredentials = async () => ({
    clientId: 'test_client_id',
    clientSecret: 'test_client_secret',
    merchantNumber: '23118',
    baseUrl: 'https://uat.realpaycollect.com:4448',
    product: 'ABSADC',
    environment: '',
    mode: 'uat',
    timeout: 5000
  });

  realpayAuthService.httpClient = {
    post: async (url) => {
      capturedUrl = url;
      return { data: { access_token: 'MOCK_TOKEN' } };
    }
  };

  try {
    await realpayAuthService.getAccessToken(null);
    assert.ok(capturedUrl.endsWith('/rpi/rpws/oauth/token'), `Expected /rpi/rpws/oauth/token but got ${capturedUrl}`);
  } finally {
    realpayAuthService.httpClient = originalHttpClient;
    realpayAuthService.getCredentials = originalGetCredentials;
    realpayAuthService.clearCache();
  }
});

test('RealPay Auth Gateway Selection - 7. case-insensitive: uat, Uat, UAT -> /rpi/rpws/oauth/token', async () => {
  realpayAuthService.clearCache();
  const originalHttpClient = realpayAuthService.httpClient;
  const originalGetCredentials = realpayAuthService.getCredentials;

  for (const envVal of ['uat', 'Uat', 'UAT']) {
    let capturedUrl = '';
    realpayAuthService.getCredentials = async () => ({
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret',
      merchantNumber: '23118',
      baseUrl: 'https://uat.realpaycollect.com:4448',
      product: 'ABSADC',
      environment: envVal,
      mode: 'production',
      timeout: 5000
    });

    realpayAuthService.httpClient = {
      post: async (url) => {
        capturedUrl = url;
        return { data: { access_token: 'MOCK_TOKEN' } };
      }
    };

    try {
      await realpayAuthService.getAccessToken(null);
      assert.ok(capturedUrl.endsWith('/rpi/rpws/oauth/token'), `Expected /rpi/rpws/oauth/token for ${envVal} but got ${capturedUrl}`);
    } finally {
      realpayAuthService.clearCache();
    }
  }

  realpayAuthService.httpClient = originalHttpClient;
  realpayAuthService.getCredentials = originalGetCredentials;
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

  const realpayClient = require('../../src/services/realpay/realpayClient');
  const originalPost = realpayClient.post;
  let clientNumberUsedInClient = '';
  let clientNumberUsedInMandate = '';

  realpayClient.post = async (path, payload, tenantId, parser) => {
    if (path.includes('/maintain/clients')) {
      clientNumberUsedInClient = payload.ClientPostRequest?.[0]?.ClientNumber;
      return { ClientPostResponse: [{ Successful: [{ RecordNumber: 1, ClientNumber: clientNumberUsedInClient }], Failed: [] }] };
    }
    const mandateItem = payload.MandatePostRequest?.[0] || {};
    clientNumberUsedInMandate = mandateItem.ClientNumber;
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
    assert.equal(clientNumberUsedInClient, 'LAPP-TEST-001');
    assert.equal(clientNumberUsedInMandate, 'LAPP-TEST-001');
  } finally {
    realpayClient.post = originalPost;
  }
});

test('RealPay Service - Client Registration Failure STOPS Mandate Creation', async () => {
  const samplePayload = {
    clientReference: 'LAPP-1038',
    debtorName: 'Test Debtor',
    debtorId: '9001015009087',
    debtorAccountNumber: '1234567890',
    debtorBranchNumber: '051001',
    instalmentAmount: 1200
  };

  const realpayClient = require('../../src/services/realpay/realpayClient');
  const originalPost = realpayClient.post;
  let mandateCalled = false;

  realpayClient.post = async (path, payload, tenantId, parser) => {
    if (path.includes('/maintain/clients')) {
      return {
        ClientPostResponse: [
          {
            Successful: [],
            Failed: [
              {
                RecordNumber: 1,
                FailureCode: 'ADCMI05',
                FailureDescription: 'Invalid ID Number format'
              }
            ]
          }
        ]
      };
    }
    if (path.includes('/maintain/mandates')) {
      mandateCalled = true;
      return {};
    }
  };

  try {
    await assert.rejects(
      () => realpayService.initiateMandate(samplePayload, null),
      (err) => err.code === 'REALPAY_PROVIDER_REJECTION' && err.message.includes('ADCMI05')
    );
    assert.equal(mandateCalled, false, 'Mandate creation MUST NOT be called if client registration fails!');
  } finally {
    realpayClient.post = originalPost;
  }
});

test('RealPay Service - Client Already Exists (ADCMI01) allows Mandate Creation to proceed safely', async () => {
  const samplePayload = {
    clientReference: 'LAPP-1038',
    debtorName: 'Test Debtor',
    debtorId: '9001015009087',
    debtorAccountNumber: '1234567890',
    debtorBranchNumber: '051001',
    instalmentAmount: 1200
  };

  const realpayClient = require('../../src/services/realpay/realpayClient');
  const originalPost = realpayClient.post;
  let mandateCalled = false;

  realpayClient.post = async (path, payload, tenantId, parser) => {
    if (path.includes('/maintain/clients')) {
      return {
        ClientPostResponse: [
          {
            Successful: [],
            Failed: [
              {
                RecordNumber: 1,
                FailureCode: 'ADCMI01',
                FailureDescription: 'Client already exists'
              }
            ]
          }
        ]
      };
    }
    if (path.includes('/maintain/mandates')) {
      mandateCalled = true;
      const mockData = {
        statusCode: '00',
        statusDescription: 'Mandate Registered Successfully',
        mandateId: 'RPM-EXISTING-CLIENT-01',
        clientReference: 'LAPP-1038'
      };
      return parser ? parser(mockData) : mockData;
    }
  };

  try {
    const res = await realpayService.initiateMandate(samplePayload, null);
    assert.equal(mandateCalled, true, 'Mandate creation MUST proceed if client already exists');
    assert.equal(res.mandateId, 'RPM-EXISTING-CLIENT-01');
    assert.equal(res.realPayClient.alreadyExisted, true);
  } finally {
    realpayClient.post = originalPost;
  }
});

test('RealPay Idempotency - REJECTED mandate + explicit reinitiate starts a NEW attempt', () => {
  const idempotencyService = require('../../src/services/idempotencyService');
  const tenantId = 'tenant_test_1001';
  const appId = '6a733c0a7b48bd2352138cef';
  const clientRef = 'LAPP-1038';

  // Build attempt 1 key
  const attempt1Key = idempotencyService.buildKey('realpay', tenantId, 'initiateMandate', appId, clientRef, 'attempt_1000');
  assert.ok(attempt1Key.includes('attempt_1000'));

  // Build attempt 2 key after explicit reinitiate
  const attempt2Key = idempotencyService.buildKey('realpay', tenantId, 'initiateMandate', appId, clientRef, 'attempt_2000');
  assert.ok(attempt2Key.includes('attempt_2000'));
  assert.notEqual(attempt1Key, attempt2Key, 'Re-initiation MUST produce a new attempt key');

  // Test pure decision logic
  const reqHash = idempotencyService.hashRequest({ appId });
  const completedRecord = { status: 'completed', requestHash: reqHash, response: { outcome: 'REJECTED' } };

  // Same key + same hash -> replay
  const replayDecision = idempotencyService.decide(completedRecord, reqHash);
  assert.equal(replayDecision.type, 'replay');

  // New key (null existing) -> run new attempt
  const newAttemptDecision = idempotencyService.decide(null, reqHash);
  assert.equal(newAttemptDecision.type, 'run');
});

test('RealPay Service - Parses nested Failures array (DUPLICATE RECORD IN TAJLND) as usable ALREADY_REGISTERED', () => {
  const mockResponse = {
    ClientPostResponse: [
      {
        Successful: [],
        Failed: [
          {
            RecordNumber: 1,
            ClientNumber: "LAPP-1038",
            Failures: [
              {
                FailureDescription: "DUPLICATE RECORD ALREADY EXISTS IN TAJLND"
              }
            ]
          }
        ]
      }
    ]
  };

  const parsed = realpayService.normalizeClientResponse(mockResponse, 'LAPP-1038');
  assert.equal(parsed.success, true);
  assert.equal(parsed.usable, true);
  assert.equal(parsed.alreadyExisted, true);
  assert.equal(parsed.status, 'ALREADY_REGISTERED');
  assert.ok(parsed.statusDescription.includes('TAJLND'));
});

test('RealPay Service - Bank code mapping resolves Capitec (8), FNB (4), Standard (5), ABSA (6)', () => {
  assert.equal(realpayService.mapBankNameToRealPayCode('Capitec'), 8);
  assert.equal(realpayService.mapBankNameToRealPayCode('FNB'), 4);
  assert.equal(realpayService.mapBankNameToRealPayCode('Standard Bank'), 5);
  assert.equal(realpayService.mapBankNameToRealPayCode('ABSA'), 6);
  assert.equal(realpayService.mapBankNameToRealPayCode('', 10), 8); // NuPay Capitec 10 -> RealPay 8
});

test('RealPay Service - Preserves all provider Failures[] in normalizeMandateResponse (ADCMI45, ADCMI1, ADCMIT17, ADCMI29)', () => {
  const mockMultiFailureResponse = {
    MandatePostResponse: [
      {
        Successful: [],
        Failed: [
          {
            RecordNumber: 1,
            Failures: [
              { FailureCode: 'ADCMI45', FailureDescription: 'Mandate Authentication Type must be valid for Mandate Product' },
              { FailureCode: 'ADCMI1', FailureDescription: 'Mandate Authorization Product is Required' },
              { FailureCode: 'ADCMIT17', FailureDescription: 'Mandate Authorization Product not linked to Beneficiary' },
              { FailureCode: 'ADCMI29', FailureDescription: 'Benefeciary User Cellphone or Telephone Number Required' }
            ]
          }
        ]
      }
    ],
    APIResponse: { Status: 'SUCCESS' }
  };

  const parsed = realpayService.normalizeMandateResponse(mockMultiFailureResponse, 'initiateMandate', 'LAPP-1038', 'LAPP1038');
  assert.equal(parsed.outcome, 'REJECTED');
  assert.equal(parsed.statusCode, 'ADCMI45');
  assert.equal(parsed.providerFailures.length, 4);
  assert.equal(parsed.providerFailures[0].code, 'ADCMI45');
  assert.equal(parsed.providerFailures[1].code, 'ADCMI1');
  assert.equal(parsed.providerFailures[2].code, 'ADCMIT17');
  assert.equal(parsed.providerFailures[3].code, 'ADCMI29');
});

test('RealPay Simulation Service - Mandate Simulation Request Schema & PUT Method', async () => {
  const realpaySimulationService = require('../../src/services/realpay/realpaySimulation.service');
  const realpayClient = require('../../src/services/realpay/realpayClient');
  const originalPut = realpayClient.put;

  let capturedPath = '';
  let capturedPayload = null;

  realpayClient.put = async (path, payload) => {
    capturedPath = path;
    capturedPayload = payload;
    return {
      MandateSimulatePutResponse: [
        {
          Successful: [{ MandateSequence: 'SEQ-1001' }],
          Failed: []
        }
      ],
      APIResponse: { Status: 'SUCCESS' }
    };
  };

  try {
    const res = await realpaySimulationService.simulateMandate({
      contractSequence: 'SEQ-1001',
      statusCode: 'S',
      result: 'AAUT'
    }, null);

    assert.equal(capturedPath, '/maintain/simulate/mandate/ABSADC?BeneficiaryUser=23118&Version=v1');
    assert.ok(capturedPayload.MandateSimulatePutRequest);
    assert.equal(capturedPayload.MandateSimulatePutRequest[0].ContractSequence, 'SEQ-1001');
    assert.equal(capturedPayload.MandateSimulatePutRequest[0].MandateInitiateStatusCode, 'S');
    assert.equal(capturedPayload.MandateSimulatePutRequest[0].MandateInitiateResult, 'AAUT');
    assert.equal(res.outcome, 'ACCEPTED');
    assert.equal(res.operation, 'simulateMandate');
  } finally {
    realpayClient.put = originalPut;
  }
});

test('RealPay Simulation Service - Instalment Simulation Request Schema', async () => {
  const realpaySimulationService = require('../../src/services/realpay/realpaySimulation.service');
  const realpayClient = require('../../src/services/realpay/realpayClient');
  const originalPut = realpayClient.put;

  let capturedPath = '';
  let capturedPayload = null;

  realpayClient.put = async (path, payload) => {
    capturedPath = path;
    capturedPayload = payload;
    return {
      InstalmentSimulatePutResponse: [
        {
          Successful: [{ ContractSequence: 'SEQ-1001' }],
          Failed: []
        }
      ],
      APIResponse: { Status: 'SUCCESS' }
    };
  };

  try {
    const res = await realpaySimulationService.simulateInstalment({
      contractSequence: 'SEQ-1001',
      statusCode: 'S',
      result: 'SUCC'
    }, null);

    assert.equal(capturedPath, '/maintain/simulate/instalment/ABSADC?BeneficiaryUser=23118&Version=v1');
    assert.ok(capturedPayload.InstalmentSimulatePutRequest);
    assert.equal(capturedPayload.InstalmentSimulatePutRequest[0].ContractSequence, 'SEQ-1001');
    assert.equal(capturedPayload.InstalmentSimulatePutRequest[0].InstalmentStatusCode, 'S');
    assert.equal(capturedPayload.InstalmentSimulatePutRequest[0].InstalmentResult, 'SUCC');
    assert.equal(res.outcome, 'ACCEPTED');
    assert.equal(res.operation, 'simulateInstalment');
  } finally {
    realpayClient.put = originalPut;
  }
});

test('RealPay Simulation Service - Rejects missing ContractSequence', async () => {
  const realpaySimulationService = require('../../src/services/realpay/realpaySimulation.service');
  await assert.rejects(
    () => realpaySimulationService.simulateMandate({ contractSequence: '' }, null),
    (err) => err.code === 'REALPAY_CONFIG_ERROR' && err.message.includes('ContractSequence is missing')
  );
});

test('RealPay Simulation Service - Blocks simulation in PRODUCTION environment', async () => {
  const realpaySimulationService = require('../../src/services/realpay/realpaySimulation.service');
  const realpayAuthService = require('../../src/services/realpay/realpayAuth.service');
  const originalGetCreds = realpayAuthService.getCredentials;

  realpayAuthService.getCredentials = async () => ({
    environment: 'PRODUCTION',
    product: 'ABSADC',
    merchantNumber: '23118'
  });

  try {
    await assert.rejects(
      () => realpaySimulationService.simulateMandate({ contractSequence: 'SEQ-1001' }, null),
      (err) => err.code === 'REALPAY_SIMULATION_NOT_ALLOWED' && err.statusCode === 403
    );
  } finally {
    realpayAuthService.getCredentials = originalGetCreds;
  }
});

test('Debit Order Provider - Provider resolution', async () => {
  const provider = await debitOrderProvider.resolveProviderName(null);
  assert.equal(provider, 'realpay');
});

test('RealPay Service - TransactionType Mapping (TT1R default, TT1D, TT2)', () => {
  assert.equal(realpayService.resolveTransactionType('TT1'), 'TT1R');
  assert.equal(realpayService.resolveTransactionType('TT1R'), 'TT1R');
  assert.equal(realpayService.resolveTransactionType('realtime'), 'TT1R');
  assert.equal(realpayService.resolveTransactionType('TT1D'), 'TT1D');
  assert.equal(realpayService.resolveTransactionType('delayed'), 'TT1D');
  assert.equal(realpayService.resolveTransactionType('TT2'), 'TT2');
  assert.equal(realpayService.resolveTransactionType(''), 'TT1R');
});

test('RealPay Service - MandateType Validation (F, V, U allowed; invalid throws)', () => {
  assert.equal(realpayService.resolveMandateType('F'), 'F');
  assert.equal(realpayService.resolveMandateType('V'), 'V');
  assert.equal(realpayService.resolveMandateType('U'), 'U');
  assert.equal(realpayService.resolveMandateType('f'), 'F');

  assert.throws(
    () => realpayService.resolveMandateType('0230'),
    (err) => err.code === 'REALPAY_CONFIG_ERROR' && err.message.includes('Invalid MandateType "0230"')
  );
  assert.throws(
    () => realpayService.resolveMandateType('INVALID'),
    (err) => err.code === 'REALPAY_CONFIG_ERROR'
  );
});

test('RealPay Service - Provider-confirmed Mandate Post Payload Mapping (No ADCTT1, FDCTT2, or 0230 assumptions)', async () => {
  const samplePayload = {
    clientReference: 'LAPP-1038',
    debtorName: 'Test Debtor',
    debtorId: '9001015009087',
    debtorAccountNumber: '1234567890',
    debtorBranchNumber: '051001',
    instalmentAmount: 1200,
    flowType: 'TT1' // Default flowType
  };

  const realpayClient = require('../../src/services/realpay/realpayClient');
  const originalPost = realpayClient.post;
  let capturedMandatePayload = null;

  realpayClient.post = async (path, payload, tenantId, parser) => {
    if (path.includes('/maintain/clients')) {
      return { ClientPostResponse: [{ Successful: [{ RecordNumber: 1, ClientNumber: 'LAPP-1038' }], Failed: [] }] };
    }
    if (path.includes('/maintain/mandates')) {
      capturedMandatePayload = payload;
      const mockData = {
        statusCode: '00',
        statusDescription: 'Mandate Registered Successfully',
        mandateId: 'RPM-1038-TEST',
        clientReference: 'LAPP-1038',
        contractSequence: '9011154048'
      };
      return parser ? parser(mockData) : mockData;
    }
  };

  try {
    const res = await realpayService.initiateMandate(samplePayload, null);
    const item = capturedMandatePayload.MandatePostRequest[0];

    assert.equal(item.MandateProduct, 'ABSADC');
    assert.equal(item.MandateType, 'F', 'MandateType must be F (Fixed Mandate)');
    assert.equal(item.TransactionType, 'TT1R', 'Default TT1 flow MUST map to TT1R');
    assert.notEqual(item.TransactionType, 'ADCTT1', 'Payload MUST NOT use ADCTT1');
    assert.notEqual(item.TransactionType, 'FDCTT2', 'Payload MUST NOT use FDCTT2');
    assert.notEqual(item.MandateType, '0230', 'Payload MUST NOT use 0230 for MandateType');
    assert.equal(item.ClientNumber, 'LAPP-1038');
    assert.equal(res.contractSequence, '9011154048');
  } finally {
    realpayClient.post = originalPost;
  }
});

test('RealPay Client PUT Support - 1. realpayClient.put exists as a function', () => {
  const realpayClient = require('../../src/services/realpay/realpayClient');
  assert.equal(typeof realpayClient.put, 'function', 'realpayClient.put must be defined as a function');
});

test('RealPay Client PUT Support - 2. PUT request uses OAuth bearer token, UAT URL, and exact endpoint/payload', async () => {
  const realpayClient = require('../../src/services/realpay/realpayClient');
  const realpaySimulationService = require('../../src/services/realpay/realpaySimulation.service');

  const originalRequest = realpayClient.request;
  let capturedConfig = null;

  realpayClient.request = async (method, path, payload, tenantId, parser) => {
    capturedConfig = { method, path, payload, tenantId };
    return {
      MandateSimulatePutResponse: [
        {
          Successful: [
            {
              ContractSequence: 1011268615,
              MandateInitiateStatusCode: 'S',
              MandateInitiateResult: 'AAUT'
            }
          ]
        }
      ]
    };
  };

  try {
    const res = await realpaySimulationService.simulateMandate({
      contractSequence: '1011268615',
      statusCode: 'S',
      result: 'AAUT'
    });

    assert.equal(capturedConfig.method, 'PUT');
    assert.equal(capturedConfig.path, '/maintain/simulate/mandate/ABSADC?BeneficiaryUser=23118&Version=v1');
    assert.deepStrictEqual(capturedConfig.payload, {
      MandateSimulatePutRequest: [
        {
          ContractSequence: '1011268615',
          MandateInitiateStatusCode: 'S',
          MandateInitiateResult: 'AAUT'
        }
      ]
    });
    assert.equal(res.outcome, 'ACCEPTED');
    assert.equal(res.statusCode, '00');
  } finally {
    realpayClient.request = originalRequest;
  }
});

test('RealPay Client PUT Support - 3. Instalment simulation uses PUT with exact endpoint and payload', async () => {
  const realpayClient = require('../../src/services/realpay/realpayClient');
  const realpaySimulationService = require('../../src/services/realpay/realpaySimulation.service');

  const originalRequest = realpayClient.request;
  let capturedConfig = null;

  realpayClient.request = async (method, path, payload, tenantId, parser) => {
    capturedConfig = { method, path, payload, tenantId };
    return {
      InstalmentSimulatePutResponse: [
        {
          Successful: [
            {
              ContractSequence: 1011268615,
              InstalmentStatusCode: 'S',
              InstalmentResult: 'SUCC'
            }
          ]
        }
      ]
    };
  };

  try {
    const res = await realpaySimulationService.simulateInstalment({
      contractSequence: '1011268615',
      statusCode: 'S',
      result: 'SUCC'
    });

    assert.equal(capturedConfig.method, 'PUT');
    assert.equal(capturedConfig.path, '/maintain/simulate/instalment/ABSADC?BeneficiaryUser=23118&Version=v1');
    assert.deepStrictEqual(capturedConfig.payload, {
      InstalmentSimulatePutRequest: [
        {
          ContractSequence: '1011268615',
          InstalmentStatusCode: 'S',
          InstalmentResult: 'SUCC'
        }
      ]
    });
    assert.equal(res.outcome, 'ACCEPTED');
    assert.equal(res.statusCode, '00');
  } finally {
    realpayClient.request = originalRequest;
  }
});

test('RealPay Webhook Fix - 1. PascalCase ContractSequence & MandateInitiateStatusCode pass Joi validation', () => {
  const { realpayWebhookSchema, extractRealPayCallbackFields } = require('../../src/utils/realpayValidation');

  const realPayCallbackPayload = {
    ContractSequence: 1011268615,
    MandateInitiateStatusCode: 'S',
    MandateInitiateResult: 'AAUT'
  };

  const { error } = realpayWebhookSchema.validate(realPayCallbackPayload);
  assert.equal(error, undefined, 'PascalCase ContractSequence & MandateInitiateStatusCode must pass validation');

  const extracted = extractRealPayCallbackFields(realPayCallbackPayload);
  assert.equal(extracted.contractSeq, '1011268615');
  assert.equal(extracted.status, 'S');
  assert.equal(extracted.ref, '1011268615');
});

test('RealPay Webhook Fix - 2. Wrapped MandateSimulatePutResponse payload passes validation', () => {
  const { realpayWebhookSchema, extractRealPayCallbackFields } = require('../../src/utils/realpayValidation');

  const wrappedPayload = {
    MandateSimulatePutResponse: [
      {
        Successful: [
          {
            ContractSequence: 1011268615,
            MandateInitiateStatusCode: 'S',
            MandateInitiateResult: 'AAUT'
          }
        ]
      }
    ]
  };

  const { error } = realpayWebhookSchema.validate(wrappedPayload);
  assert.equal(error, undefined, 'Wrapped MandateSimulatePutResponse must pass validation');

  const extracted = extractRealPayCallbackFields(wrappedPayload);
  assert.equal(extracted.contractSeq, '1011268615');
  assert.equal(extracted.status, 'S');
});

test('RealPay Simulation Controller Contract - sendSuccess orders (res, messageString, dataObject)', () => {
  const { sendSuccess } = require('../../src/utils/responseHandler');

  const mockRes = {
    statusCode: 0,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      return this;
    }
  };

  const simResult = {
    provider: 'REALPAY',
    outcome: 'ACCEPTED',
    contractSequence: '1011268615'
  };

  sendSuccess(mockRes, 'RealPay mandate simulation request sent successfully', simResult);

  assert.equal(mockRes.statusCode, 200);
  assert.equal(typeof mockRes.jsonBody.message, 'string', 'message must be a string to avoid React render crash');
  assert.equal(mockRes.jsonBody.message, 'RealPay mandate simulation request sent successfully');
  assert.deepStrictEqual(mockRes.jsonBody.data, simResult, 'data must contain the structured simResult object');
});

test('RealPay Webhook Fix - 3. MandateGetResponse wrapper payload passes validation and extracts ContractSequence', () => {
  const { realpayWebhookSchema, extractRealPayCallbackFields } = require('../../src/utils/realpayValidation');

  const mandateGetPayload = {
    MandateGetResponse: [
      {
        ContractSequence: 1011268615,
        ClientNumber: 'LAPP-1038',
        ContractNumber: 'LAPP1038',
        MandateProduct: 'ABSADC',
        MandateInitiateStatusCode: 'S',
        MandateInitiateResult: 'AAUT'
      }
    ],
    APIResponse: { Status: 'SUCCESS' }
  };

  const { error } = realpayWebhookSchema.validate(mandateGetPayload);
  assert.equal(error, undefined, 'MandateGetResponse wrapper payload must pass Joi validation');

  const extracted = extractRealPayCallbackFields(mandateGetPayload);
  assert.equal(extracted.callbackType, 'MANDATE');
  assert.equal(extracted.contractSeq, '1011268615');
  assert.equal(extracted.clientRef, 'LAPP-1038');
  assert.equal(extracted.status, 'S');
});

test('RealPay Webhook Fix - 4. InstalmentGetResponse wrapper payload passes validation and extracts InstalmentSequence', () => {
  const { realpayWebhookSchema, extractRealPayCallbackFields } = require('../../src/utils/realpayValidation');

  const instalmentGetPayload = {
    InstalmentGetResponse: [
      {
        ContractSequence: 1011268615,
        InstalmentSequence: 1,
        ClientNumber: 'LAPP-1038',
        ContractNumber: 'LAPP1038',
        InstalmentStatusCode: 'S',
        InstalmentResult: 'SUCC',
        InstalmentAmount: 1500.00
      }
    ],
    APIResponse: { Status: 'SUCCESS' }
  };

  const { error } = realpayWebhookSchema.validate(instalmentGetPayload);
  assert.equal(error, undefined, 'InstalmentGetResponse wrapper payload must pass Joi validation');

  const extracted = extractRealPayCallbackFields(instalmentGetPayload);
  assert.equal(extracted.callbackType, 'INSTALMENT');
  assert.equal(extracted.contractSeq, '1011268615');
  assert.equal(extracted.instalmentSeq, '1');
  assert.equal(extracted.clientRef, 'LAPP-1038');
  assert.equal(extracted.status, 'S');
});

test('RealPay Repeat Simulation Prevention - Completed mandate simulation returns HTTP 400', async () => {
  const { simulateMandateEndpoint } = require('../../src/controllers/admin/realpaySimulationController');
  const LoanApplication = require('../../src/models/LoanApplication');

  const originalFindOne = LoanApplication.findOne;
  LoanApplication.findOne = async () => ({
    applicationId: 'LAPP-1038',
    realPayMandate: { contractSequence: '1011268615', status: 'ACCEPTED' },
    realPaySimulation: { mandate: { completedAt: new Date(), result: 'ACCEPTED' } }
  });

  const mockRes = {
    statusCode: 0,
    jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; }
  };

  try {
    await simulateMandateEndpoint({ body: { applicationId: 'LAPP-1038' } }, mockRes);
    assert.equal(mockRes.statusCode, 400);
    assert.equal(mockRes.jsonBody.code, 'REALPAY_SIMULATION_ALREADY_COMPLETED');
  } finally {
    LoanApplication.findOne = originalFindOne;
  }
});

test('RealPay Callback Security - Missing HMAC signature rejected when REALPAY_CALLBACK_HMAC_REQUIRED is set', async () => {
  const { handleRealPayWebhook } = require('../../src/controllers/realpayWebhookController');
  const originalHmacReq = process.env.REALPAY_CALLBACK_HMAC_REQUIRED;
  process.env.REALPAY_CALLBACK_HMAC_REQUIRED = 'true';

  const mockReq = {
    body: { ContractSequence: 1011268615, MandateInitiateStatusCode: 'S' },
    headers: {}
  };
  const mockRes = {
    statusCode: 0,
    jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; }
  };

  try {
    await handleRealPayWebhook(mockReq, mockRes);
    assert.equal(mockRes.statusCode, 401);
    assert.equal(mockRes.jsonBody.code, 'REALPAY_HMAC_INVALID');
  } finally {
    if (originalHmacReq === undefined) delete process.env.REALPAY_CALLBACK_HMAC_REQUIRED;
    else process.env.REALPAY_CALLBACK_HMAC_REQUIRED = originalHmacReq;
  }
});

test('RealPay Atomic Callback Update - Mandate callback never overwrites existing instalmentSequence with empty value', async () => {
  const { handleRealPayWebhook } = require('../../src/controllers/realpayWebhookController');
  const LoanApplication = require('../../src/models/LoanApplication');

  const mockApp = {
    _id: '507f1f77bcf86cd799439011',
    applicationId: 'LAPP-1038',
    realPayMandate: { contractSequence: '1011268615', status: 'ACCEPTED', instalmentSequence: '1' },
    realPaySimulation: {
      mandate: { contractSequence: '1011268615', result: 'ACCEPTED' },
      instalment: { contractSequence: '1011268615', instalmentSequence: '1', result: 'ACCEPTED' }
    }
  };

  const originalFindOne = LoanApplication.findOne;
  const originalFindOneAndUpdate = LoanApplication.findOneAndUpdate;

  let updateSetPassed = null;
  LoanApplication.findOne = async () => mockApp;
  LoanApplication.findOneAndUpdate = async (filter, update) => {
    updateSetPassed = update.$set;
    return { ...mockApp, ...update.$set };
  };

  const mandatePayload = {
    MandateGetResponse: [
      {
        ContractSequence: 1011268615,
        MandateInitiateStatusCode: 'S',
        MandateInitiateResult: 'AAUT'
      }
    ]
  };

  const mockRes = {
    statusCode: 0,
    jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; }
  };

  try {
    await handleRealPayWebhook({ body: mandatePayload, headers: {} }, mockRes);
    assert.equal(mockRes.statusCode, 200);
    assert.equal(updateSetPassed['realPayMandate.instalmentSequence'], undefined, 'Mandate callback without sequence must NEVER set or overwrite instalmentSequence with empty value');
  } finally {
    LoanApplication.findOne = originalFindOne;
    LoanApplication.findOneAndUpdate = originalFindOneAndUpdate;
  }
});






