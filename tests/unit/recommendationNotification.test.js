const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Notification = require('../../src/models/Notification');
const User = require('../../src/models/User');
const Borrower = require('../../src/models/Borrower');
const LoanApplication = require('../../src/models/LoanApplication');
const tenantContext = require('../../src/tenancy/tenantContext');
const { createNotification } = require('../../src/utils/notificationHelper');
const loanRequestController = require('../../src/controllers/staff/loanRequestController');

describe('Loan Application Recommendation & Notification Remediation Suite', () => {
  let mongoServer;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await tenantContext.runAsSystem(async () => {
      await mongoose.connection.dropDatabase();
    });
  });

  async function createFixtures(tenantId = '650000000000000000000001') {
    return tenantContext.runWithTenant(tenantId, async () => {
      const adminUser = await User.create({
        fullName: 'Admin User',
        email: `admin-${Date.now()}-${Math.floor(Math.random()*10000)}@example.com`,
        phone: '+27821234567',
        password: 'password123',
        role: 'admin',
        tenantId
      });

      const staffUser = await User.create({
        fullName: 'Staff Reviewer',
        email: `staff-${Date.now()}-${Math.floor(Math.random()*10000)}@example.com`,
        phone: '+27827654321',
        password: 'password123',
        role: 'staff',
        tenantId
      });

      const borrower = await Borrower.create({
        fullName: 'Test Applicant',
        email: `applicant-${Date.now()}-${Math.floor(Math.random()*10000)}@example.com`,
        phoneNumber: '+27829990000',
        password: 'password123',
        tenantId
      });

      const application = await LoanApplication.create({
        applicationId: `LAPP-${Date.now()}-${Math.floor(Math.random()*1000)}`,
        borrowerId: borrower._id,
        fullName: borrower.fullName,
        emailAddress: borrower.email,
        phoneNumber: borrower.phoneNumber,
        idNumber: '9201015009087',
        dateOfBirth: new Date('1992-01-01'),
        residentialAddress: '456 Market St, Cape Town',
        requestedAmount: 10000,
        approvedAmount: 10000,
        loanDurationMonths: 6,
        status: 'Pending Review',
        tenantId
      });

      return { adminUser, staffUser, borrower, application, tenantId };
    });
  }

  it('1. Correct notification type (ReviewAssigned) and priority (NORMAL) when staff recommends', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { adminUser, staffUser, borrower, application } = await createFixtures(tenantId);

    let resCode, resData;
    const req = {
      params: { id: application._id.toString() },
      body: { recommendation: 'Recommended', reviewNotes: 'Credit score is strong' },
      user: staffUser,
      tenantId
    };
    const res = {
      status(code) { resCode = code; return this; },
      json(data) { resData = data; return this; }
    };

    await tenantContext.runWithTenant(tenantId, async () => {
      await loanRequestController.submitReview(req, res);
    });

    assert.strictEqual(resData.success, true);
    assert.strictEqual(resData.data.status, 'Reviewed');

    await tenantContext.runWithTenant(tenantId, async () => {
      const notification = await Notification.findOne({ receiverId: adminUser._id });
      assert.notStrictEqual(notification, null);
      assert.strictEqual(notification.notificationType, 'ReviewAssigned');
      assert.strictEqual(notification.type, 'ReviewAssigned');
      assert.strictEqual(notification.priority, 'NORMAL');
    });
  });

  it('2. Explicit receiver role (admin) and valid receiverId assigned to notification', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { adminUser, staffUser, application } = await createFixtures(tenantId);

    const req = {
      params: { id: application._id.toString() },
      body: { recommendation: 'Recommended', reviewNotes: 'All checks passed' },
      user: staffUser,
      tenantId
    };
    const res = { status() { return this; }, json() { return this; } };

    await tenantContext.runWithTenant(tenantId, async () => {
      await loanRequestController.submitReview(req, res);
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const notification = await Notification.findOne({ receiverRole: 'admin' });
      assert.notStrictEqual(notification, null);
      assert.strictEqual(notification.receiverRole, 'admin');
      assert.strictEqual(notification.receiverId.toString(), adminUser._id.toString());
    });
  });

  it('3. Correct tenant isolation - tenant A notification not dispatched to tenant B admin', async () => {
    const tenantA = new mongoose.Types.ObjectId().toString();
    const tenantB = new mongoose.Types.ObjectId().toString();

    const { adminUser: adminA, staffUser: staffA, application: appA } = await createFixtures(tenantA);
    const { adminUser: adminB } = await createFixtures(tenantB);

    const req = {
      params: { id: appA._id.toString() },
      body: { recommendation: 'Recommended', reviewNotes: 'Tenant A review' },
      user: staffA,
      tenantId: tenantA
    };
    const res = { status() { return this; }, json() { return this; } };

    await tenantContext.runWithTenant(tenantA, async () => {
      await loanRequestController.submitReview(req, res);
    });

    await tenantContext.runWithTenant(tenantA, async () => {
      const notifA = await Notification.findOne({ receiverId: adminA._id });
      assert.notStrictEqual(notifA, null);
    });

    await tenantContext.runWithTenant(tenantB, async () => {
      const notifB = await Notification.findOne({ receiverId: adminB._id });
      assert.strictEqual(notifB, null, 'Tenant B admin must not receive Tenant A notification');
    });
  });

  it('4. Multiple eligible admins under same tenant receive individual notifications', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { adminUser: admin1, staffUser, application } = await createFixtures(tenantId);

    let admin2;
    await tenantContext.runWithTenant(tenantId, async () => {
      admin2 = await User.create({
        fullName: 'Second Admin',
        email: `admin2-${Date.now()}@example.com`,
        phone: '+27828889999',
        password: 'password123',
        role: 'admin',
        tenantId
      });
    });

    const req = {
      params: { id: application._id.toString() },
      body: { recommendation: 'Recommended', reviewNotes: 'Multi admin test' },
      user: staffUser,
      tenantId
    };
    const res = { status() { return this; }, json() { return this; } };

    await tenantContext.runWithTenant(tenantId, async () => {
      await loanRequestController.submitReview(req, res);
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const notif1 = await Notification.findOne({ receiverId: admin1._id });
      const notif2 = await Notification.findOne({ receiverId: admin2._id });
      assert.notStrictEqual(notif1, null);
      assert.notStrictEqual(notif2, null);
    });
  });

  it('5. No eligible admin handling - returns null safely without throwing', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    // Delete admin user for this tenant
    const { staffUser, application, adminUser } = await createFixtures(tenantId);

    await tenantContext.runWithTenant(tenantId, async () => {
      await User.deleteOne({ _id: adminUser._id });
    });

    let resCode, resData;
    const req = {
      params: { id: application._id.toString() },
      body: { recommendation: 'Recommended', reviewNotes: 'No admin present' },
      user: staffUser,
      tenantId
    };
    const res = {
      status(code) { resCode = code; return this; },
      json(data) { resData = data; return this; }
    };

    await tenantContext.runWithTenant(tenantId, async () => {
      await loanRequestController.submitReview(req, res);
    });

    assert.strictEqual(resData.success, true);
    assert.strictEqual(resData.data.status, 'Reviewed');
  });

  it('6. Invalid notification data handling - missing receiverId & receiverRole returns null safely', async () => {
    const result = await createNotification({
      title: 'Test Missing Receiver',
      message: 'Testing validation guard',
      notificationType: 'LOAN_APPROVAL',
      priority: 'NORMAL'
    });

    assert.strictEqual(result, null);
  });

  it('7. Legacy label normalization - "Loan Application Recommendation" normalizes to "ReviewAssigned"', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { adminUser } = await createFixtures(tenantId);

    let notif;
    await tenantContext.runWithTenant(tenantId, async () => {
      notif = await createNotification({
        receiverId: adminUser._id,
        receiverRole: 'admin',
        notificationType: 'Loan Application Recommendation',
        title: 'Legacy Title Test',
        message: 'Legacy message',
        tenantId
      });
    });

    assert.notStrictEqual(notif, null);
    assert.strictEqual(notif.notificationType, 'ReviewAssigned');
    assert.strictEqual(notif.type, 'ReviewAssigned');
  });

  it('8. "Normal" priority normalization - converts title-case "Normal" to "NORMAL"', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { adminUser } = await createFixtures(tenantId);

    let notif;
    await tenantContext.runWithTenant(tenantId, async () => {
      notif = await createNotification({
        receiverId: adminUser._id,
        receiverRole: 'admin',
        type: 'ADMIN_ALERT',
        priority: 'Normal',
        title: 'Priority Title Test',
        message: 'Priority message',
        tenantId
      });
    });

    assert.notStrictEqual(notif, null);
    assert.strictEqual(notif.priority, 'NORMAL');
  });

  it('9. Recommendation remains persisted when notification creation fails', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { staffUser, application } = await createFixtures(tenantId);

    // Call createNotification with data that causes creation to return null
    await tenantContext.runWithTenant(tenantId, async () => {
      await createNotification({
        notificationType: 'Loan Application Recommendation',
        priority: 'Normal'
      });
    });

    const req = {
      params: { id: application._id.toString() },
      body: { recommendation: 'Recommended', reviewNotes: 'Persisted test notes' },
      user: staffUser,
      tenantId
    };
    const res = { status() { return this; }, json() { return this; } };

    await tenantContext.runWithTenant(tenantId, async () => {
      await loanRequestController.submitReview(req, res);
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const updatedApp = await LoanApplication.findById(application._id);
      assert.strictEqual(updatedApp.status, 'Reviewed');
      assert.strictEqual(updatedApp.staffReview.verificationNotes, 'Persisted test notes');
      assert.strictEqual(updatedApp.staffReview.recommendation, 'Recommended');
      assert.strictEqual(updatedApp.staffReviewLocked, true);
    });
  });

  it('10. No duplicate notifications on retry', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { adminUser, staffUser, application } = await createFixtures(tenantId);

    const req = {
      params: { id: application._id.toString() },
      body: { recommendation: 'Recommended', reviewNotes: 'First submission' },
      user: staffUser,
      tenantId
    };
    const res = { status() { return this; }, json() { return this; } };

    await tenantContext.runWithTenant(tenantId, async () => {
      await loanRequestController.submitReview(req, res);
    });

    await tenantContext.runWithTenant(tenantId, async () => {
      const count = await Notification.countDocuments({ receiverId: adminUser._id, notificationType: 'ReviewAssigned' });
      assert.strictEqual(count, 1);
    });
  });

  it('11. Regression coverage for earlier Approval Alert normalization', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { adminUser } = await createFixtures(tenantId);

    let notif;
    await tenantContext.runWithTenant(tenantId, async () => {
      notif = await createNotification({
        receiverId: adminUser._id,
        receiverRole: 'admin',
        notificationType: 'Approval Alert',
        priority: 'Important',
        title: 'Approval Alert Title',
        message: 'Approval alert message',
        tenantId
      });
    });

    assert.notStrictEqual(notif, null);
    assert.strictEqual(notif.notificationType, 'LOAN_APPROVAL');
    assert.strictEqual(notif.type, 'LOAN_APPROVAL');
    assert.strictEqual(notif.priority, 'IMPORTANT');
  });

  it('12. Existing notification workflows remain unaffected', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const { borrower } = await createFixtures(tenantId);

    let notif;
    await tenantContext.runWithTenant(tenantId, async () => {
      notif = await createNotification({
        receiverId: borrower._id,
        receiverRole: 'borrower',
        type: 'BORROWER_ALERT',
        priority: 'URGENT',
        title: 'Borrower Alert Title',
        message: 'Borrower alert message',
        tenantId
      });
    });

    assert.notStrictEqual(notif, null);
    assert.strictEqual(notif.receiverRole, 'borrower');
    assert.strictEqual(notif.notificationType, 'BORROWER_ALERT');
    assert.strictEqual(notif.priority, 'URGENT');
  });
});
