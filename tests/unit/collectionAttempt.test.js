const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const CollectionAttempt = require('../../src/models/CollectionAttempt');
const tenantContext = require('../../src/tenancy/tenantContext');

describe('CollectionAttempt Model Tests', () => {
  let mongoServer;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    await CollectionAttempt.syncIndexes();
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it('should successfully create a collection attempt', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const borrowerId = new mongoose.Types.ObjectId();
    const loanId = new mongoose.Types.ObjectId();
    const repaymentScheduleId = new mongoose.Types.ObjectId();

    await tenantContext.runWithTenant(tenantId, async () => {
      const attempt = await CollectionAttempt.create({
        borrowerId,
        loanId,
        repaymentScheduleId,
        installmentIdentifier: 'EMI-1',
        collectionMethod: 'DEBICHECK',
        provider: 'REALPAY',
        requestedAmount: 1500,
        providerReference: 'RPM-12345'
      });

      assert.strictEqual(attempt.status, 'PENDING');
      assert.strictEqual(attempt.attemptNumber, 1);
      assert.strictEqual(attempt.collectionMethod, 'DEBICHECK');
      assert.strictEqual(attempt.provider, 'REALPAY');
      assert.strictEqual(attempt.fallbackStatus, 'NOT_ELIGIBLE');
      assert.ok(attempt.tenantId.equals(tenantId));
    });
  });

  it('should prevent cross-tenant access to collection attempts', async () => {
    const tenantA = new mongoose.Types.ObjectId();
    const tenantB = new mongoose.Types.ObjectId();

    await tenantContext.runWithTenant(tenantA, async () => {
      await CollectionAttempt.create({
        borrowerId: new mongoose.Types.ObjectId(),
        loanId: new mongoose.Types.ObjectId(),
        repaymentScheduleId: new mongoose.Types.ObjectId(),
        collectionMethod: 'DEBICHECK',
        provider: 'REALPAY',
        requestedAmount: 500
      });
    });

    await tenantContext.runWithTenant(tenantB, async () => {
      const attemptsInTenantB = await CollectionAttempt.find({});
      assert.strictEqual(attemptsInTenantB.length, 0);
    });
  });

  it('should reject duplicate idempotency keys within the same tenant', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const idempotencyKey = 'UNIQUE-WEBHOOK-ID';

    await tenantContext.runWithTenant(tenantId, async () => {
      await CollectionAttempt.create({
        borrowerId: new mongoose.Types.ObjectId(),
        loanId: new mongoose.Types.ObjectId(),
        repaymentScheduleId: new mongoose.Types.ObjectId(),
        collectionMethod: 'DEBICHECK',
        provider: 'REALPAY',
        requestedAmount: 500,
        idempotencyKey
      });

      try {
        await CollectionAttempt.create({
          borrowerId: new mongoose.Types.ObjectId(),
          loanId: new mongoose.Types.ObjectId(),
          repaymentScheduleId: new mongoose.Types.ObjectId(),
          collectionMethod: 'DEBICHECK',
          provider: 'REALPAY',
          requestedAmount: 500,
          idempotencyKey
        });
        assert.fail('Should have thrown a duplicate key error');
      } catch (err) {
        assert.ok(err.code === 11000 || /duplicate|E11000/i.test(err.message), 'Expected duplicate key error');
      }
    });
  });

  it('should allow valid status transitions', async () => {
    const tenantId = new mongoose.Types.ObjectId();

    await tenantContext.runWithTenant(tenantId, async () => {
      const attempt = await CollectionAttempt.create({
        borrowerId: new mongoose.Types.ObjectId(),
        loanId: new mongoose.Types.ObjectId(),
        repaymentScheduleId: new mongoose.Types.ObjectId(),
        collectionMethod: 'PAYFAST_CARD',
        provider: 'PAYFAST',
        requestedAmount: 500
      });

      attempt.status = 'SUCCESS';
      await attempt.save();

      const updated = await CollectionAttempt.findById(attempt._id);
      assert.strictEqual(updated.status, 'SUCCESS');
    });
  });
});
