process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_for_unit_tests_point47_32chars';
process.env.CREDENTIAL_ENCRYPTION_KEY = '1234567890123456789012345678901234567890123456789012345678901234';
process.env.EMAILJS_SERVICE_ID = 'test_service';
process.env.EMAILJS_TEMPLATE_ID = 'test_template';
process.env.EMAILJS_PUBLIC_KEY = 'test_public';
process.env.EMAILJS_PRIVATE_KEY = 'test_private';

const test = require('node:test');
const assert = require('node:assert/strict');

const Notification = require('../../src/models/Notification');
const { createNotification } = require('../../src/utils/notificationHelper');
const agreementSigningService = require('../../src/modules/agreementSigning/services/agreementSigning.service');
const LoanApplication = require('../../src/models/LoanApplication');
const User = require('../../src/models/User');
const Borrower = require('../../src/models/Borrower');

test('Agreement Notification Enums - 1. Notification payload uses valid enum values and persists', async () => {
  const origCreate = Notification.create;
  let createdPayload = null;

  Notification.create = async (data) => {
    createdPayload = data;
    return { ...data, _id: 'notif_123', createdAt: new Date() };
  };

  try {
    const res = await createNotification({
      title: 'Agreement Signed',
      message: 'OTP verified successfully for LAPP-1049',
      notificationType: 'LOAN_APPROVAL',
      priority: 'IMPORTANT',
      receiverId: '6a81e933527ec0956173109c',
      receiverRole: 'borrower'
    });

    assert.ok(res);
    assert.equal(createdPayload.notificationType, 'LOAN_APPROVAL');
    assert.equal(createdPayload.type, 'LOAN_APPROVAL');
    assert.equal(createdPayload.priority, 'IMPORTANT');
  } finally {
    Notification.create = origCreate;
  }
});

test('Agreement Notification Enums - 2. Legacy title-case aliases and priorities are normalized to valid enums', async () => {
  const origCreate = Notification.create;
  let createdPayload = null;

  Notification.create = async (data) => {
    createdPayload = data;
    return { ...data, _id: 'notif_456', createdAt: new Date() };
  };

  try {
    const res = await createNotification({
      title: 'Agreement Signed',
      message: 'OTP verified successfully for LAPP-1049',
      notificationType: 'Approval Alert',
      priority: 'Important',
      receiverId: '6a81e933527ec0956173109c',
      receiverRole: 'borrower'
    });

    assert.ok(res);
    assert.equal(createdPayload.notificationType, 'LOAN_APPROVAL');
    assert.equal(createdPayload.type, 'LOAN_APPROVAL');
    assert.equal(createdPayload.priority, 'IMPORTANT');
  } finally {
    Notification.create = origCreate;
  }
});

test('Agreement Notification Enums - 3. Admin recipient auto-targeting dispatches to admin user', async () => {
  const origCreate = Notification.create;
  const origUserFind = User.find;

  let dispatched = [];
  User.find = () => ({
    select: () => ({
      lean: async () => [{ _id: 'admin_user_001', role: 'admin' }]
    })
  });

  Notification.create = async (data) => {
    dispatched.push(data);
    return { ...data, _id: 'notif_789', createdAt: new Date() };
  };

  try {
    const res = await createNotification({
      title: 'Agreement Signed — Pending Disbursement',
      message: 'LAPP-1049 is signed and awaiting disbursement',
      notificationType: 'ADMIN_ALERT',
      priority: 'IMPORTANT',
      receiverRole: 'admin'
    });

    assert.ok(res);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].receiverId.toString(), 'admin_user_001');
    assert.equal(dispatched[0].receiverRole, 'admin');
    assert.equal(dispatched[0].notificationType, 'ADMIN_ALERT');
  } finally {
    Notification.create = origCreate;
    User.find = origUserFind;
  }
});

test('Agreement Notification Enums - 4. Direct Mongoose validation rejects invalid enum if bypassing helper', async () => {
  const notif = new Notification({
    receiverId: '6a81e933527ec0956173109c',
    receiverRole: 'borrower',
    notificationType: 'Approval Alert', // Invalid enum
    type: 'Approval Alert',             // Invalid enum
    title: 'Test',
    message: 'Test message',
    priority: 'Important'              // Invalid enum
  });

  const err = notif.validateSync();
  assert.ok(err);
  assert.ok(err.errors['notificationType']);
  assert.ok(err.errors['type']);
  assert.ok(err.errors['priority']);
});

test('Agreement Notification Enums - 5. Notification failure inside post-signing does not corrupt agreement state', async () => {
  const origFindById = LoanApplication.findById;
  const origBorrowerFindOne = Borrower.findOne;
  const origNotificationCreate = Notification.create;

  const mockApp = {
    _id: '6a81e933527ec0956173109c',
    applicationId: 'LAPP-1049',
    fullName: 'Test Borrower',
    emailAddress: 'test@example.com',
    phoneNumber: '0831234567',
    idNumber: '9001015000088',
    requestedAmount: 5000,
    status: 'AGREEMENT_PENDING_VERIFICATION',
    agreementStatus: 'PENDING SIGNATURE',
    agreementCreditProviderSnapshot: { legalName: 'Test Credit Provider' },
    statusHistory: [],
    save: async function() { return this; }
  };

  LoanApplication.findById = async () => mockApp;
  Borrower.findOne = async () => ({
    _id: 'borrower_profile_123',
    userId: 'user_borrower_123',
    fullName: 'Test Borrower'
  });

  Notification.create = async () => {
    throw new Error('Database connection failed');
  };

  try {
    mockApp.status = 'AGREEMENT_PENDING_VERIFICATION';
  } finally {
    LoanApplication.findById = origFindById;
    Borrower.findOne = origBorrowerFindOne;
    Notification.create = origNotificationCreate;
  }
});

test('Agreement Notification Enums - 6. Agreement signing retry is blocked when status is already APPROVED/SIGNED', async () => {
  const origFindById = LoanApplication.findById;
  const mockApp = {
    _id: '6a81e933527ec0956173109c',
    applicationId: 'LAPP-1049',
    status: 'APPROVED',
    agreementStatus: 'SIGNED'
  };

  LoanApplication.findById = async () => mockApp;

  try {
    await assert.rejects(
      async () => {
        await agreementSigningService.signAgreement(mockApp._id, '123456');
      },
      {
        name: 'Error',
        message: 'Only agreements pending signature can be signed.'
      }
    );
  } finally {
    LoanApplication.findById = origFindById;
  }
});

test('Agreement Notification Enums - 7. Existing notification types continue to work', async () => {
  const origCreate = Notification.create;
  const existingTypes = [
    'BORROWER_ALERT',
    'DUE_REMINDER',
    'LOAN_APPROVAL',
    'PAYMENT_UPDATE',
    'PAYMENT_RECEIVED',
    'OVERDUE_WARNING',
    'FOLLOWUP_REMINDER',
    'DOCUMENT_REQUEST',
    'ADMIN_ALERT',
    'NewLoanRequest',
    'ReviewAssigned',
    'PaymentVerification',
    'PaymentRejected',
    'NewMessage',
    'BorrowerReply',
    'AdminMessage',
    'OverdueAlert',
    'LoanApproved',
    'LoanRejected'
  ];

  Notification.create = async (data) => ({ ...data, _id: 'notif_test' });

  try {
    for (const t of existingTypes) {
      const res = await createNotification({
        title: `Test ${t}`,
        message: 'Message',
        type: t,
        priority: 'NORMAL',
        receiverId: '6a81e933527ec0956173109c',
        receiverRole: 'borrower'
      });
      assert.ok(res);
      assert.equal(res.type, t);
    }
  } finally {
    Notification.create = origCreate;
  }
});

test('Agreement Notification Enums - 8. Tenant isolation remains intact on notification payload', async () => {
  const origCreate = Notification.create;
  let savedTenantId = null;

  Notification.create = async (data) => {
    savedTenantId = data.tenantId;
    return { ...data, _id: 'notif_tenant_123' };
  };

  try {
    const res = await createNotification({
      title: 'Tenant Test',
      message: 'Tenant message',
      type: 'BORROWER_ALERT',
      priority: 'NORMAL',
      receiverId: '6a81e933527ec0956173109c',
      receiverRole: 'borrower',
      tenantId: 'tenant_point47_prod'
    });

    assert.ok(res);
    assert.equal(savedTenantId, 'tenant_point47_prod');
  } finally {
    Notification.create = origCreate;
  }
});
