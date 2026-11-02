const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Groups R Us Insurance Service Unit Tests', () => {
  const service = require('../../src/services/groupsRUsInsuranceService');

  it('TC-SRV-01: Correctly formats date to CCYY/MM/DD', () => {
    const formatted = service.formatDate(new Date('2026-11-15T10:00:00Z'));
    assert.strictEqual(formatted, '2026/11/15');
  });

  it('TC-SRV-02: Normalizes object payload parameters without sending undefined', async () => {
    const result = await service.activatePolicy({
      clientIdNumber: '9201015800087',
      loanRefNumber: 'LAPP-2026-TEST',
      hasVoluntaryLife: true
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.policyNumber, 'Must return policy number');
  });

  it('TC-SRV-03: Refuses to generate mock policy number when environment is LIVE and no credentials exist', async () => {
    // Temporarily mock getConfig to simulate LIVE environment
    const originalGetConfig = service.getConfig;
    service.getConfig = async () => ({
      environment: 'LIVE',
      baseUrl: 'https://restapi.groupsrus.co.za/ws_finapi/',
      username: '',
      password: '',
      branchCode: '001',
      hasCredentials: false
    });

    const result = await service.activatePolicy({
      clientIdNumber: '9201015800087',
      loanRefNumber: 'LAPP-LIVE-FAIL',
      hasVoluntaryLife: false
    });

    // Restore original getConfig
    service.getConfig = originalGetConfig;

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.liveMode, true);
    assert.ok(!result.policyNumber, 'Must NOT generate fake policy number in LIVE mode');
  });

  it('TC-SRV-04: Formats CancelPolicy payload and handles object input', async () => {
    const cancelRes = await service.cancelPolicy({
      clientIdNumber: '9201015800087',
      policyRefNumber: 'POL-12345',
      reason: 'Loan application rejected by admin'
    });

    assert.ok(cancelRes);
    assert.strictEqual(cancelRes.reply_cd, '200');
  });
});

