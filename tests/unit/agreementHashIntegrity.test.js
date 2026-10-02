process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_for_unit_tests_point47_32chars';
process.env.CREDENTIAL_ENCRYPTION_KEY = '1234567890123456789012345678901234567890123456789012345678901234';
process.env.EMAILJS_SERVICE_ID = 'test_service';
process.env.EMAILJS_TEMPLATE_ID = 'test_template';
process.env.EMAILJS_PUBLIC_KEY = 'test_public';
process.env.EMAILJS_PRIVATE_KEY = 'test_private';

const test = require('node:test');
const assert = require('node:assert/strict');

const { generateVerificationHash } = require('../../src/utils/verificationHashEngine');
const agreementSigningService = require('../../src/modules/agreementSigning/services/agreementSigning.service');
const LoanApplication = require('../../src/models/LoanApplication');
const Borrower = require('../../src/models/Borrower');
const User = require('../../src/models/User');

function createMockAppAndBorrower() {
  const borrower = {
    _id: '6581e933527ec0956173109c',
    userId: 'user_123',
    idNumber: '9001015000088',
    phoneNumber: '0831234567',
    employmentStatus: 'Employed'
  };

  const app = {
    _id: '6581e933527ec0956173109d',
    applicationId: 'LAPP-1049',
    borrowerId: '6581e933527ec0956173109c',
    idNumber: '9001015000088',
    phoneNumber: '0831234567',
    requestedAmount: 10000,
    loanType: 'Personal Loan',
    estimatedMonthlyEMI: 1200,
    affordabilityOutcome: {
      income: { basicSalary: 25000, allowances: 2000, overtime: 1000, otherIncome: 500 },
      expenses: { totalExpenses: 12000 }
    }
  };

  return { app, borrower };
}

test('Hash Integrity - 1. Deterministic SHA-256 hash calculation succeeds', () => {
  const { app, borrower } = createMockAppAndBorrower();
  const hash = generateVerificationHash(app, borrower);
  assert.ok(hash);
  assert.equal(typeof hash, 'string');
  assert.equal(hash.length, 64);
});

test('Hash Integrity - 2. Populated borrowerId document evaluates identically to unpopulated ObjectId string', () => {
  const { app, borrower } = createMockAppAndBorrower();
  const unpopulatedHash = generateVerificationHash(app, borrower);

  const populatedApp = {
    ...app,
    borrowerId: {
      _id: '6581e933527ec0956173109c',
      fullName: 'Tebogo Borrower',
      email: 'tebogo@example.com'
    }
  };

  const populatedHash = generateVerificationHash(populatedApp, borrower);
  assert.equal(populatedHash, unpopulatedHash);
});

test('Hash Integrity - 3. Modification of signed application fields produces hash mismatch', () => {
  const { app, borrower } = createMockAppAndBorrower();
  const originalHash = generateVerificationHash(app, borrower);

  const modifiedApp = {
    ...app,
    requestedAmount: 15000 // Tampered requested amount
  };

  const modifiedHash = generateVerificationHash(modifiedApp, borrower);
  assert.notEqual(modifiedHash, originalHash);
});

test('Hash Integrity - 4. Numeric string inputs vs Numbers are normalized deterministically', () => {
  const { app, borrower } = createMockAppAndBorrower();
  const hash1 = generateVerificationHash(app, borrower);

  const appWithStrings = {
    ...app,
    requestedAmount: '10000',
    estimatedMonthlyEMI: '1200',
    affordabilityOutcome: {
      income: { basicSalary: '25000', allowances: '2000', overtime: '1000', otherIncome: '500' },
      expenses: { totalExpenses: '12000' }
    }
  };

  const hash2 = generateVerificationHash(appWithStrings, borrower);
  assert.equal(hash2, hash1);
});

test('Hash Integrity - 5. Missing or null affordability fields handle fallback defaults without crashing', () => {
  const { app, borrower } = createMockAppAndBorrower();
  delete app.affordabilityOutcome;

  const hash = generateVerificationHash(app, borrower);
  assert.ok(hash);
  assert.equal(hash.length, 64);
});

test('Hash Integrity - 6. Verification hash mismatch blocks ready-for-disbursement server-side', async () => {
  const origFindById = LoanApplication.findById;
  const origBorrowerFindOne = Borrower.findOne;

  const { app, borrower } = createMockAppAndBorrower();

  const mockApp = {
    ...app,
    status: 'APPROVED',
    agreementStatus: 'SIGNED',
    agreementSignedAt: new Date(),
    debicheckMandateStatus: 'ACCEPTED',
    creditAssessment: { verificationHash: 'INVALID_CORRUPTED_HASH_STRING_12345' },
    save: async function() { return this; }
  };

  LoanApplication.findById = async () => mockApp;
  Borrower.findOne = async () => borrower;

  try {
    await assert.rejects(
      async () => {
        await agreementSigningService.markReadyForDisbursement(mockApp._id, 'admin123');
      },
      {
        name: 'Error',
        message: 'Cannot mark loan ready for disbursement: Agreement verification hash mismatch detected.'
      }
    );
  } finally {
    LoanApplication.findById = origFindById;
    Borrower.findOne = origBorrowerFindOne;
  }
});

test('Hash Integrity - 7. Missing verification hash when creditAssessment exists blocks ready-for-disbursement', async () => {
  const origFindById = LoanApplication.findById;
  const origBorrowerFindOne = Borrower.findOne;

  const { app, borrower } = createMockAppAndBorrower();

  const mockApp = {
    ...app,
    status: 'APPROVED',
    agreementStatus: 'SIGNED',
    agreementSignedAt: new Date(),
    debicheckMandateStatus: 'ACCEPTED',
    creditAssessment: { status: 'RECOMMENDED', verificationHash: '' }, // Empty hash
    save: async function() { return this; }
  };

  LoanApplication.findById = async () => mockApp;
  Borrower.findOne = async () => borrower;

  try {
    await assert.rejects(
      async () => {
        await agreementSigningService.markReadyForDisbursement(mockApp._id, 'admin123');
      },
      {
        name: 'Error',
        message: 'Cannot mark loan ready for disbursement: Credit assessment verification hash is missing.'
      }
    );
  } finally {
    LoanApplication.findById = origFindById;
    Borrower.findOne = origBorrowerFindOne;
  }
});

test('Hash Integrity - 8. Valid verification hash allows ready-for-disbursement to succeed', async () => {
  const origFindById = LoanApplication.findById;
  const origBorrowerFindOne = Borrower.findOne;
  const origUserFindById = User.findById;

  const { app, borrower } = createMockAppAndBorrower();
  const validHash = generateVerificationHash(app, borrower);

  const mockApp = {
    ...app,
    status: 'APPROVED',
    agreementStatus: 'SIGNED',
    agreementSignedAt: new Date(),
    debicheckMandateStatus: 'ACCEPTED',
    creditAssessment: { verificationHash: validHash },
    statusHistory: [],
    save: async function() { return this; }
  };

  LoanApplication.findById = async () => mockApp;
  Borrower.findOne = async () => borrower;
  User.findById = async () => ({ _id: 'admin123', fullName: 'Admin' });

  try {
    const res = await agreementSigningService.markReadyForDisbursement(mockApp._id, 'admin123');
    assert.equal(res.status, 'Ready for Disbursement');
  } finally {
    LoanApplication.findById = origFindById;
    Borrower.findOne = origBorrowerFindOne;
    User.findById = origUserFindById;
  }
});
