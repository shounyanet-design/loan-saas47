const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VALID_COLLECTION_STATUSES,
  normalizeDebi24Status,
  resolveDebi24ClientId,
  applyCollectionStatusUpdate
} = require('../../src/services/debi24SyncService');

test('normalizeDebi24Status maps bank and Debi24 collection statuses accurately', () => {
  // Successful states
  assert.equal(normalizeDebi24Status('PAID'), 'Successful');
  assert.equal(normalizeDebi24Status('SUCCESSFUL'), 'Successful');
  assert.equal(normalizeDebi24Status('SETTLED'), 'Successful');
  assert.equal(normalizeDebi24Status('PROCESSED'), 'Successful');
  assert.equal(normalizeDebi24Status('SUCCESS'), 'Successful');

  // Failed states
  assert.equal(normalizeDebi24Status('FAILED'), 'Failed');
  assert.equal(normalizeDebi24Status('UNPAID'), 'Failed');
  assert.equal(normalizeDebi24Status('BOUNCED'), 'Failed');
  assert.equal(normalizeDebi24Status('REJECTED'), 'Failed');
  assert.equal(normalizeDebi24Status('INSUFFICIENT_FUNDS'), 'Failed');
  assert.equal(normalizeDebi24Status('RETURNED'), 'Failed');

  // In Tracking states
  assert.equal(normalizeDebi24Status('IN_TRACKING'), 'In Tracking');
  assert.equal(normalizeDebi24Status('TRACKING'), 'In Tracking');
  assert.equal(normalizeDebi24Status('PENDING'), 'In Tracking');
  assert.equal(normalizeDebi24Status('SUBMITTED'), 'In Tracking');

  // Disputed states
  assert.equal(normalizeDebi24Status('DISPUTED'), 'Disputed');
  assert.equal(normalizeDebi24Status('DISPUTE'), 'Disputed');

  // Cancelled states
  assert.equal(normalizeDebi24Status('CANCELLED'), 'Cancelled');
  assert.equal(normalizeDebi24Status('CANCELED'), 'Cancelled');

  // Recalled states
  assert.equal(normalizeDebi24Status('RECALLED'), 'Recalled');

  // Scheduled / Active states
  assert.equal(normalizeDebi24Status('SCHEDULED'), 'Scheduled');
  assert.equal(normalizeDebi24Status('ACTIVE'), 'Scheduled');

  // Fallback
  assert.equal(normalizeDebi24Status(''), 'Unknown');
  assert.equal(normalizeDebi24Status(null), 'Unknown');
  assert.equal(normalizeDebi24Status('SOMETHING_RANDOM'), 'Unknown');
});

test('resolveDebi24ClientId resolves tenant-specific downstream client IDs', () => {
  const origClientId = process.env.DEBI24_CLIENT_ID;
  process.env.DEBI24_CLIENT_ID = 'pointfortyseven';

  // 1. Explicit debi24ClientId configured on Tenant
  assert.equal(resolveDebi24ClientId({ debi24ClientId: 'Dimeva-Finance' }), 'Dimeva-Finance');

  // 2. Default tenant fallback
  assert.equal(resolveDebi24ClientId({ isDefault: true, companyName: 'Main Org' }), 'pointfortyseven');

  // 3. Custom tenant with company name
  assert.equal(resolveDebi24ClientId({ companyName: 'Chana Investment' }), 'Chana-Investment');

  // 4. Null tenant fallback
  assert.equal(resolveDebi24ClientId(null), 'pointfortyseven');

  process.env.DEBI24_CLIENT_ID = origClientId;
});

test('applyCollectionStatusUpdate rejects invalid status values', async () => {
  const mockLoan = { collectionStatus: 'Scheduled' };
  await assert.rejects(
    async () => {
      await applyCollectionStatusUpdate(mockLoan, { collectionStatus: 'NonExistentStatus' });
    },
    { message: 'Invalid collection status: NonExistentStatus' }
  );
});
