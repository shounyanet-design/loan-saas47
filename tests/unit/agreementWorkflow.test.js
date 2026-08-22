// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_for_unit_tests_point47_32chars';
process.env.CREDENTIAL_ENCRYPTION_KEY = '1234567890123456789012345678901234567890123456789012345678901234';
process.env.EMAILJS_SERVICE_ID = 'test_service';
process.env.EMAILJS_TEMPLATE_ID = 'test_template';
process.env.EMAILJS_PUBLIC_KEY = 'test_public';
process.env.EMAILJS_PRIVATE_KEY = 'test_private';

const test = require('node:test');
const assert = require('node:assert/strict');

const LoanApplication = require('../../src/models/LoanApplication');
const User = require('../../src/models/User');
const Borrower = require('../../src/models/Borrower');
const ActiveLoan = require('../../src/models/ActiveLoan');
const agreementSigningService = require('../../src/modules/agreementSigning/services/agreementSigning.service');

// Helper to generate mock LoanApplication
function createMockApplication(overrides = {}) {
  const defaultApp = {
    _id: '6a81e933527ec0956173109c',
    applicationId: 'LAPP-1038',
    fullName: 'Tebogo Shounyane',
    emailAddress: 'shounyanet@gmail.com',
    phoneNumber: '0839858917',
    idNumber: '8309135520085',
    requestedAmount: 15000,
    requestedDuration: 1,
    estimatedMonthlyEMI: 17940,
    interestRate: 36,
    status: 'Draft',
    agreementStatus: 'Not Generated',
    agreementGenerated: false,
    agreementGeneratedAt: null,
    agreementSignedAt: null,
    otpVerificationStatus: 'Pending',
    borrowerConsentVerified: false,
    debicheckMandateStatus: '',
    realPayMandate: { status: '' },
    nupayMandate: { outcome: '' },
    amlVerification: { isBlocked: false },
    statusHistory: [],
    save: async function() { return this; }
  };

  return { ...defaultApp, ...overrides, statusHistory: overrides.statusHistory ? [...overrides.statusHistory] : [] };
}

// Mock User & Borrower lookups to avoid live DB dependency in pure unit tests
const origUserFindById = User.findById;
const origBorrowerFindOne = Borrower.findOne;
const origActiveLoanUpdateMany = ActiveLoan.updateMany;

User.findById = async (id) => ({
  _id: id || 'admin123',
  fullName: 'Test Admin',
  name: 'Test Admin',
  role: 'admin'
});

Borrower.findOne = async () => null;
ActiveLoan.updateMany = async () => ({ acknowledged: true, modifiedCount: 1 });

test('Agreement Workflow - 1. NOT_GENERATED agreement cannot disburse', async () => {
  const origFindById = LoanApplication.findById;
  const mockApp = createMockApplication({
    status: 'Approved',
    agreementStatus: 'Not Generated',
    agreementGenerated: false,
    debicheckMandateStatus: 'ACCEPTED'
  });
  LoanApplication.findById = async () => mockApp;

  try {
    await assert.rejects(
      async () => {
        await agreementSigningService.markReadyForDisbursement(mockApp._id, 'admin123');
      },
      {
        name: 'Error',
        message: 'Only signed agreements can be marked ready for disbursement.'
      }
    );
  } finally {
    LoanApplication.findById = origFindById;
  }
});

test('Agreement Workflow - 2. GENERATED but unsigned (PENDING SIGNATURE) cannot disburse', async () => {
  const origFindById = LoanApplication.findById;
  const mockApp = createMockApplication({
    status: 'AGREEMENT_PENDING_VERIFICATION',
    agreementStatus: 'PENDING SIGNATURE',
    agreementGenerated: true,
    agreementGeneratedAt: new Date(),
    agreementSignedAt: null,
    debicheckMandateStatus: 'ACCEPTED'
  });
  LoanApplication.findById = async () => mockApp;

  try {
    await assert.rejects(
      async () => {
        await agreementSigningService.markReadyForDisbursement(mockApp._id, 'admin123');
      },
      {
        name: 'Error',
        message: 'Only signed agreements can be marked ready for disbursement.'
      }
    );
  } finally {
    LoanApplication.findById = origFindById;
  }
});

test('Agreement Workflow - 3. OTP VERIFIED alone without signed status cannot disburse', async () => {
  const origFindById = LoanApplication.findById;
  const mockApp = createMockApplication({
    status: 'AGREEMENT_PENDING_VERIFICATION',
    agreementStatus: 'Not Generated',
    agreementGenerated: false,
    otpVerificationStatus: 'VERIFIED',
    agreementSignedAt: null,
    debicheckMandateStatus: 'ACCEPTED'
  });
  LoanApplication.findById = async () => mockApp;

  try {
    await assert.rejects(
      async () => {
        await agreementSigningService.markReadyForDisbursement(mockApp._id, 'admin123');
      },
      {
        name: 'Error',
        message: 'Only signed agreements can be marked ready for disbursement.'
      }
    );
  } finally {
    LoanApplication.findById = origFindById;
  }
});

test('Agreement Workflow - 4. Borrower Consent alone cannot disburse', async () => {
  const origFindById = LoanApplication.findById;
  const mockApp = createMockApplication({
    status: 'Submitted',
    agreementStatus: 'Not Generated',
    borrowerConsentVerified: true,
    agreementSignedAt: null,
    debicheckMandateStatus: 'ACCEPTED'
  });
  LoanApplication.findById = async () => mockApp;

  try {
    await assert.rejects(
      async () => {
        await agreementSigningService.markReadyForDisbursement(mockApp._id, 'admin123');
      },
      {
        name: 'Error',
        message: 'Only signed agreements can be marked ready for disbursement.'
      }
    );
  } finally {
    LoanApplication.findById = origFindById;
  }
});

test('Agreement Workflow - 5. SIGNED agreement + RealPay DebiCheck ACCEPTED + AML clear can mark ready', async () => {
  const origFindById = LoanApplication.findById;
  const mockApp = createMockApplication({
    status: 'APPROVED',
    agreementStatus: 'SIGNED',
    agreementGenerated: true,
    agreementGeneratedAt: new Date('2026-08-16T16:54:10.907Z'),
    agreementSignedAt: new Date('2026-08-16T16:55:15.333Z'),
    otpVerificationStatus: 'VERIFIED',
    borrowerConsentVerified: true,
    debicheckMandateStatus: 'ACCEPTED',
    realPayMandate: { status: 'ACCEPTED', contractSequence: '1011268615' },
    amlVerification: { isBlocked: false }
  });
  LoanApplication.findById = async () => mockApp;

  try {
    const res = await agreementSigningService.markReadyForDisbursement(mockApp._id, 'admin123');
    assert.equal(res.status, 'Ready for Disbursement');
    assert.equal(res.agreementStatus, 'SIGNED');
    const latestHistory = res.statusHistory[res.statusHistory.length - 1];
    assert.equal(latestHistory.status, 'Ready for Disbursement');
  } finally {
    LoanApplication.findById = origFindById;
  }
});

test('Agreement Workflow - 6. RealPay DebiCheck rejected blocks disbursement', async () => {
  const origFindById = LoanApplication.findById;
  const mockApp = createMockApplication({
    status: 'APPROVED',
    agreementStatus: 'SIGNED',
    agreementSignedAt: new Date(),
    debicheckMandateStatus: 'REJECTED',
    realPayMandate: { status: 'REJECTED' }
  });
  LoanApplication.findById = async () => mockApp;

  try {
    await assert.rejects(
      async () => {
        await agreementSigningService.markReadyForDisbursement(mockApp._id, 'admin123');
      },
      {
        name: 'Error',
        message: 'Cannot mark loan ready for disbursement: DebiCheck mandate status is not ACCEPTED.'
      }
    );
  } finally {
    LoanApplication.findById = origFindById;
  }
});

test('Agreement Workflow - 7. RealPay ACCEPTED + unsigned agreement still blocks disbursement', async () => {
  const origFindById = LoanApplication.findById;
  const mockApp = createMockApplication({
    status: 'AGREEMENT_PENDING_VERIFICATION',
    agreementStatus: 'PENDING SIGNATURE',
    agreementSignedAt: null,
    debicheckMandateStatus: 'ACCEPTED',
    realPayMandate: { status: 'ACCEPTED', contractSequence: '1011268615' }
  });
  LoanApplication.findById = async () => mockApp;

  try {
    await assert.rejects(
      async () => {
        await agreementSigningService.markReadyForDisbursement(mockApp._id, 'admin123');
      },
      {
        name: 'Error',
        message: 'Only signed agreements can be marked ready for disbursement.'
      }
    );
  } finally {
    LoanApplication.findById = origFindById;
  }
});

test('Agreement Workflow - 8. AML blocked application blocks disbursement even if signed and DebiCheck accepted', async () => {
  const origFindById = LoanApplication.findById;
  const mockApp = createMockApplication({
    status: 'APPROVED',
    agreementStatus: 'SIGNED',
    agreementSignedAt: new Date(),
    debicheckMandateStatus: 'ACCEPTED',
    realPayMandate: { status: 'ACCEPTED' },
    amlVerification: { isBlocked: true }
  });
  LoanApplication.findById = async () => mockApp;

  try {
    await assert.rejects(
      async () => {
        await agreementSigningService.markReadyForDisbursement(mockApp._id, 'admin123');
      },
      {
        name: 'Error',
        message: 'Cannot mark loan ready for disbursement: AML compliance check has blocked this application.'
      }
    );
  } finally {
    LoanApplication.findById = origFindById;
  }
});

test('Agreement Workflow - 9. Idempotency: Duplicate ready-disbursement action is safe', async () => {
  const origFindById = LoanApplication.findById;
  const mockApp = createMockApplication({
    status: 'Ready for Disbursement',
    agreementStatus: 'SIGNED',
    agreementSignedAt: new Date('2026-08-16T16:55:15.333Z'),
    debicheckMandateStatus: 'ACCEPTED',
    realPayMandate: { status: 'ACCEPTED' }
  });
  LoanApplication.findById = async () => mockApp;

  try {
    const res = await agreementSigningService.markReadyForDisbursement(mockApp._id, 'admin123');
    assert.equal(res.status, 'Ready for Disbursement');
  } finally {
    LoanApplication.findById = origFindById;
  }
});

test('Agreement Workflow - 10. Signed agreement state persists across document mutations', async () => {
  const origFindById = LoanApplication.findById;
  const mockApp = createMockApplication({
    status: 'APPROVED',
    agreementStatus: 'SIGNED',
    agreementGenerated: true,
    agreementGeneratedAt: new Date('2026-08-16T16:54:10.907Z'),
    agreementSignedAt: new Date('2026-08-16T16:55:15.333Z'),
    signedAgreement: 'Signed agreement content receipt text',
    otpVerificationStatus: 'VERIFIED',
    borrowerConsentVerified: true,
    debicheckMandateStatus: 'ACCEPTED',
    realPayMandate: { status: 'ACCEPTED', contractSequence: '1011268615' }
  });
  LoanApplication.findById = async () => mockApp;

  try {
    // Simulate an unrelated admin note update
    mockApp.notes = 'Unrelated admin note';
    await mockApp.save();

    // Ensure signed state remains intact
    assert.equal(mockApp.agreementStatus, 'SIGNED');
    assert.ok(mockApp.agreementSignedAt !== null);
    assert.equal(mockApp.otpVerificationStatus, 'VERIFIED');
    assert.equal(mockApp.borrowerConsentVerified, true);
  } finally {
    LoanApplication.findById = origFindById;
  }
});
