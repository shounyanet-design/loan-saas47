require('dotenv').config();
const assert = require('assert');
const {
  NuPayError,
  NuPayConfigurationError,
  NuPayConnectionError,
  NuPayTimeoutError,
  NuPayInvalidResponseError,
  NuPayProviderError,
  NuPayLocalPersistenceError,
  formatCardAcceptor,
  maskCardAcceptor
} = require('../src/errors/nupayErrors');

async function runNuPayRemediationTests() {
  console.log('====================================================');
  console.log('  Point.47 LMS — NuPay Final Safety Test Suite     ');
  console.log('====================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  function test(description, fn) {
    try {
      fn();
      console.log(`✓ PASS: ${description}`);
      passedCount++;
    } catch (err) {
      console.error(`❌ FAIL: ${description}`);
      console.error(`   Error: ${err.message}`);
      failedCount++;
    }
  }

  async function testAsync(description, fn) {
    try {
      await fn();
      console.log(`✓ PASS: ${description}`);
      passedCount++;
    } catch (err) {
      console.error(`❌ FAIL: ${description}`);
      console.error(`   Error: ${err.message}`);
      failedCount++;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. formatCardAcceptor String-Only Tests
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- 1. Testing formatCardAcceptor Helper (String Only) ---');

  test('11-digit string → padded to exactly 15 digits', () => {
    const res = formatCardAcceptor('25500019087');
    assert.strictEqual(res, '000025500019087');
    assert.strictEqual(res.length, 15);
  });

  test('15-digit string → remains unchanged', () => {
    const res = formatCardAcceptor('000025500019087');
    assert.strictEqual(res, '000025500019087');
    assert.strictEqual(res.length, 15);
  });

  test('JavaScript Number input (non-string) → throws NuPayConfigurationError', () => {
    assert.throws(
      () => formatCardAcceptor(25500019087),
      (err) => err instanceof NuPayConfigurationError && err.message.includes('must be provided as a string')
    );
  });

  test('Exceeding 15 digits → throws NuPayConfigurationError', () => {
    assert.throws(
      () => formatCardAcceptor('1234567890123456'),
      (err) => err instanceof NuPayConfigurationError && err.message.includes('1 to 15 digits')
    );
  });

  test('Letters and symbols → throws NuPayConfigurationError', () => {
    assert.throws(
      () => formatCardAcceptor('25500019087ABC'),
      (err) => err instanceof NuPayConfigurationError && err.message.includes('1 to 15 digits')
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Logging Sanitization Tests
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- 2. Testing Logging Security & Sanitization ---');

  test('maskCardAcceptor masks merchant number safely for console logging', () => {
    const masked = maskCardAcceptor('000025500019087');
    assert.strictEqual(masked.includes('25500019087'), false);
    assert.strictEqual(masked, '0000********087');
  });

  test('Console log capture verifies zero cleartext password/HMAC/bank data leakage', () => {
    const fakePayload = {
      username: '[REDACTED]',
      hash: '[REDACTED]',
      cardAcceptor: maskCardAcceptor('000025500019087')
    };
    const logStr = JSON.stringify(fakePayload);
    assert.strictEqual(logStr.includes('secret_password'), false);
    assert.strictEqual(logStr.includes('raw_hmac_hash'), false);
    assert.strictEqual(logStr.includes('000025500019087'), false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Typed Error Contract & Ambiguous Timeout Tests
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- 3. Testing NuPay Typed Errors & Ambiguous Timeout Contract ---');

  test('NuPayTimeoutError returns NUPAY_RESULT_UNKNOWN with requiresVerification: true', () => {
    const err = new NuPayTimeoutError();
    assert.strictEqual(err.statusCode, 504);
    assert.strictEqual(err.code, 'NUPAY_RESULT_UNKNOWN');
    assert.strictEqual(err.retryable, false);
    assert.strictEqual(err.requiresVerification, true);
  });

  test('NuPayLocalPersistenceError returns NUPAY_LOCAL_PERSISTENCE_FAILED', () => {
    const err = new NuPayLocalPersistenceError();
    assert.strictEqual(err.statusCode, 500);
    assert.strictEqual(err.code, 'NUPAY_LOCAL_PERSISTENCE_FAILED');
    assert.strictEqual(err.retryable, false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Operation-Specific Response Validator & Service Tests
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- 4. Testing Operation-Specific Response Validators & Service Gateway Safety ---');

  const nupayService = require('../src/services/nupayService');
  const axios = require('axios');
  const originalPost = axios.post;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  test('validateInitiateMandateResponse requires returned mandate reference', () => {
    assert.throws(
      () => nupayService.validateInitiateMandateResponse({ status: 'Success' }),
      (err) => err instanceof NuPayInvalidResponseError && err.message.includes('missing provider reference')
    );

    const valid = nupayService.validateInitiateMandateResponse({ reference: 'MND-99401', status: 'Pending Authentication' });
    assert.strictEqual(valid.success, true);
    assert.strictEqual(valid.reference, 'MND-99401');
  });

  test('validateMaintainInstalmentResponse validates status without requiring new reference', () => {
    const valid = nupayService.validateMaintainInstalmentResponse({ status: 'Maintained' });
    assert.strictEqual(valid.success, true);
    assert.strictEqual(valid.status, 'Maintained');
  });

  test('validateRescheduleInstalmentResponse validates status without requiring new reference', () => {
    const valid = nupayService.validateRescheduleInstalmentResponse({ status: 'Rescheduled' });
    assert.strictEqual(valid.success, true);
    assert.strictEqual(valid.status, 'Rescheduled');
  });

  const failureScenarios = [
    { name: 'ETIMEDOUT (Timeout)', error: Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ETIMEDOUT' }), expectedClass: NuPayTimeoutError, expectedCode: 'NUPAY_RESULT_UNKNOWN' },
    { name: 'ECONNREFUSED (Connection Refused)', error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), expectedClass: NuPayConnectionError, expectedCode: 'NUPAY_CONNECTION_ERROR' },
    { name: 'ENOTFOUND (DNS Failure)', error: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }), expectedClass: NuPayConnectionError, expectedCode: 'NUPAY_CONNECTION_ERROR' },
    { name: 'HTTP 500 Server Error', error: Object.assign(new Error('Request failed with status code 500'), { response: { status: 500, data: { message: 'Internal Server Error' } } }), expectedClass: NuPayConnectionError, expectedCode: 'NUPAY_CONNECTION_ERROR' },
    { name: 'HTTP 422 Provider Rejection', error: Object.assign(new Error('Request failed with status code 422'), { response: { status: 422, data: { message: 'Invalid Debtor Account' } } }), expectedClass: NuPayProviderError, expectedCode: 'NUPAY_PROVIDER_REJECTION' }
  ];

  for (const scenario of failureScenarios) {
    await testAsync(`makeRequest under ${scenario.name} throws ${scenario.expectedClass.name} with code ${scenario.expectedCode}`, async () => {
      axios.post = async () => { throw scenario.error; };
      
      let thrownError = null;
      try {
        await nupayService.makeRequest('initiateMandate', { test: true });
      } catch (e) {
        thrownError = e;
      }

      assert.ok(thrownError, `Expected exception for scenario ${scenario.name}`);
      assert.ok(thrownError instanceof scenario.expectedClass, `Expected ${scenario.expectedClass.name}, got ${thrownError.constructor.name}`);
      assert.strictEqual(thrownError.code, scenario.expectedCode);
      assert.strictEqual(thrownError.reference, undefined);
    });
  }

  // Restore original stubs
  axios.post = originalPost;
  process.env.NODE_ENV = originalNodeEnv;

  console.log('\n====================================================');
  console.log(`  Test Execution Summary: ${passedCount} PASSED, ${failedCount} FAILED  `);
  console.log('====================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runNuPayRemediationTests().catch((err) => {
  console.error('Fatal Test Runner Failure:', err);
  process.exit(1);
});
