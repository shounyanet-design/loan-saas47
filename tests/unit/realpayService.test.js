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
  const attempt1Key = idempotencyService.buildKey('nupay', tenantId, 'initiateMandate', appId, clientRef, 'attempt_1000');
  assert.ok(attempt1Key.includes('attempt_1000'));

  // Build attempt 2 key after explicit reinitiate
  const attempt2Key = idempotencyService.buildKey('nupay', tenantId, 'initiateMandate', appId, clientRef, 'attempt_2000');
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
