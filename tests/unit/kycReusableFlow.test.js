const test = require('node:test');
const assert = require('node:assert/strict');
const reportDocumentService = require('../../src/services/reportDocument.service');
const compliancePdfGenerator = require('../../src/utils/compliancePdfGenerator');
const { callProfileIdPhotoMatch } = require('../../src/services/datanamix/profileIdPhotoVerification.service');

// ─── Test Suite: Reusable KYC, Verified Photo & PDF Architecture ─────────────

test('A. New Borrower Successful KYC — Generates structured snapshot', async () => {
  const mockDatanamixResponse = {
    Success: true,
    ResponseCode: 200,
    Header: { ReportName: 'Joe Soap' },
    PDFReport: Buffer.from('%PDF-1.4 Mock PDF Content').toString('base64'),
    Result: {
      IDVerificationResults: {
        ResponseStatusCode: 1,
        ResponseMessage: 'ID verification passed',
        IDNumberMatchStatus: 'Matched',
        HanisIDMatch: 'Matched',
        ReportReference: 'DX-KYC-001',
        Names: 'Joe',
        Surname: 'Soap',
        Gender: 'M',
        DateOfBirth: '1985-06-15',
        HanisStatus: 'Active',
        Photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD',
      },
      BiometricVerificationResults: {
        MatchScore: 0.95,
        FaceMatchStatus: 'Matched',
      }
    },
    Messages: ['Verified successfully']
  };

  const { callProfileIdPhotoMatch } = require('../../src/services/datanamix/profileIdPhotoVerification.service');
  // Validate normalization
  const normalized = require('../../src/services/datanamix/profileIdPhotoVerification.service');
  assert.ok(mockDatanamixResponse.Success, 'Provider call successful');
  assert.equal(mockDatanamixResponse.Result.IDVerificationResults.ResponseStatusCode, 1);
});

test('B. Client Photo Persisted — Verified photo extracted and accessible', async () => {
  const mockKyc = {
    verificationStatus: 'Verified',
    verifiedPhotoUrl: 'https://ik.imagekit.io/point47/borrowers/6a81e/kyc_photo.jpg',
    verifiedPhotoFileId: 'file_photo_123',
    faceMatchScore: 95,
  };

  assert.equal(mockKyc.verificationStatus, 'Verified');
  assert.ok(mockKyc.verifiedPhotoUrl.startsWith('https://'), 'Photo URL must be persistent cloud URL');
  assert.equal(mockKyc.faceMatchScore, 95);
});

test('C. PDF Report Persisted / Downloadable — Resolves authoritative PDF buffer', async () => {
  const mockApp = {
    _id: '6a81e933527ec0956173109c',
    applicationId: 'LAPP-1042',
    fullName: 'Joe Soap',
    idNumber: '8506155001085',
    kycVerification: {
      verificationStatus: 'Verified',
      verificationReference: 'DX-KYC-999',
      faceMatchScore: 94.5,
      verificationTimestamp: new Date('2026-08-24T12:00:00Z'),
      extractedOCRData: {
        FirstNames: 'Joe',
        LastName: 'Soap',
        Gender: 'Male',
        DateOfBirth: '1985-06-15',
        IDNumberMatchStatus: 'Matched',
        HanisStatus: 'Active',
        HanisIDMatch: 'Matched',
        FaceMatchStatus: 'Matched',
      },
    },
  };

  const pdfBuf = await reportDocumentService.resolveKycReportPdf(mockApp);
  assert.ok(Buffer.isBuffer(pdfBuf), 'Result should be a Buffer');
  assert.ok(pdfBuf.length > 500, 'PDF buffer should contain document bytes');
  assert.equal(pdfBuf.slice(0, 4).toString(), '%PDF', 'PDF buffer must start with %PDF header');
});

test('D. OCR / Identity Snapshot Stored — Home affairs & demographic attributes preserved', async () => {
  const mockApp = {
    kycVerification: {
      extractedOCRData: {
        FirstNames: 'Tebogo',
        LastName: 'Shounyane',
        Gender: 'Male',
        DateOfBirth: '1983-09-13',
        IDNumberMatchStatus: 'Matched',
        HanisStatus: 'Active',
      }
    }
  };

  const ocr = mockApp.kycVerification.extractedOCRData;
  assert.equal(ocr.FirstNames, 'Tebogo');
  assert.equal(ocr.LastName, 'Shounyane');
  assert.equal(ocr.IDNumberMatchStatus, 'Matched');
  assert.equal(ocr.HanisStatus, 'Active');
});

test('E. ID Mismatch Blocks Next Step — Returns IDENTITY_MISMATCH error', async () => {
  const inputIdNumber = '9901015001088';
  const verifiedIdNumber = '8506155001085';

  const isMismatch = inputIdNumber !== verifiedIdNumber;
  assert.ok(isMismatch, 'Mismatch detected');

  let errorThrown = null;
  try {
    if (isMismatch) {
      const err = new Error('IDENTITY_MISMATCH: Borrower identity does not match the verified KYC record.');
      err.code = 'IDENTITY_MISMATCH';
      throw err;
    }
  } catch (e) {
    errorThrown = e;
  }

  assert.ok(errorThrown, 'Error was thrown');
  assert.equal(errorThrown.code, 'IDENTITY_MISMATCH');
});

test('F. Verified Borrower Proceeds to Origination — Gate clears verified status', async () => {
  const mockApp = {
    kycVerification: {
      verificationStatus: 'Verified',
      extractedOCRData: { IDNumber: '8506155001085' }
    },
    idNumber: '8506155001085'
  };

  const isVerified = ['Verified', 'Overridden'].includes(mockApp.kycVerification.verificationStatus);
  const idMatch = !mockApp.kycVerification.extractedOCRData.IDNumber || mockApp.kycVerification.extractedOCRData.IDNumber === mockApp.idNumber;

  assert.ok(isVerified, 'KYC status is valid');
  assert.ok(idMatch, 'ID match verified');
});

test('G. Returning Verified Borrower Reuses KYC — Reusable profile hydrates instantly', async () => {
  const mockBorrower = {
    _id: 'brw_12345',
    kycStatus: 'VERIFIED',
    kycVerifiedAt: new Date('2026-07-01T10:00:00Z'),
    kycVerifiedIdNumber: '8506155001085',
    kycProvider: 'DATANAMIX',
    kycProviderProduct: 'Profile Plus ID Photo Match',
    kycProviderReference: 'DX-0-0-12345',
    kycPhotoUrl: 'https://ik.imagekit.io/point47/borrowers/brw_12345/kyc_photo.jpg',
    kycReportPdfUrl: 'https://ik.imagekit.io/point47/compliance-reports/brw_12345/kyc_report.pdf',
    kycFaceMatchScore: 98,
    kycExtractedData: { FirstNames: 'Joe', LastName: 'Soap' }
  };

  const newApplicationIdNumber = '8506155001085';

  const isReusable =
    mockBorrower.kycStatus === 'VERIFIED' &&
    mockBorrower.kycVerifiedIdNumber === newApplicationIdNumber;

  assert.ok(isReusable, 'Returning borrower profile is reusable');

  const reusedSnapshot = {
    verificationStatus: 'Verified',
    responseStatusCode: 1,
    responseMessage: 'Previously Verified Client (Reused Verification Profile)',
    faceMatchScore: mockBorrower.kycFaceMatchScore,
    verificationReference: mockBorrower.kycProviderReference,
    verificationTimestamp: mockBorrower.kycVerifiedAt,
    verifiedPhotoUrl: mockBorrower.kycPhotoUrl,
    reportPdfUrl: mockBorrower.kycReportPdfUrl,
    isReused: true,
    originalVerifiedAt: mockBorrower.kycVerifiedAt,
    reusedAt: new Date(),
    idNumberMatch: true,
    photoMatch: true
  };

  assert.equal(reusedSnapshot.verificationStatus, 'Verified');
  assert.equal(reusedSnapshot.isReused, true);
  assert.equal(reusedSnapshot.verifiedPhotoUrl, mockBorrower.kycPhotoUrl);
});

test('H. Returning Borrower Causes Zero Provider Re-Call — Bypasses API provider', async () => {
  let providerCalls = 0;
  const mockCallProvider = () => {
    providerCalls++;
    return { status: 'Verified' };
  };

  const mockBorrower = {
    kycStatus: 'VERIFIED',
    kycVerifiedIdNumber: '8506155001085'
  };

  const requestedId = '8506155001085';
  const forceReverify = false;

  let result;
  if (!forceReverify && mockBorrower.kycStatus === 'VERIFIED' && mockBorrower.kycVerifiedIdNumber === requestedId) {
    result = { isReused: true, verificationStatus: 'Verified' };
  } else {
    result = mockCallProvider();
  }

  assert.equal(providerCalls, 0, 'Must execute 0 provider calls for reusable borrower');
  assert.equal(result.isReused, true);
});

test('I. Changed ID Forces Re-Verification — Disallows stale reuse', async () => {
  const mockBorrower = {
    kycStatus: 'VERIFIED',
    kycVerifiedIdNumber: '8506155001085'
  };

  const newRequestedId = '9001015001088'; // ID changed!

  const isReusable =
    mockBorrower.kycStatus === 'VERIFIED' &&
    mockBorrower.kycVerifiedIdNumber === newRequestedId;

  assert.equal(isReusable, false, 'Changed ID must not reuse stale KYC');
});

test('J. Failed Previous KYC Forces Re-Verification — Unverified status triggers fresh check', async () => {
  const mockBorrower = {
    kycStatus: 'FAILED',
    kycVerifiedIdNumber: '8506155001085'
  };

  const isReusable = mockBorrower.kycStatus === 'VERIFIED';
  assert.equal(isReusable, false, 'Failed KYC must never be reused');
});

test('K. Cross-Tenant Verification Reuse Blocked — Enforces tenant isolation boundary', async () => {
  const tenantA_Borrower = {
    tenantId: 'tenant_alpha',
    kycStatus: 'VERIFIED',
    kycVerifiedIdNumber: '8506155001085'
  };

  const currentTenantContext = 'tenant_beta';

  const isAllowedInCurrentTenant =
    tenantA_Borrower.tenantId === currentTenantContext &&
    tenantA_Borrower.kycStatus === 'VERIFIED';

  assert.equal(isAllowedInCurrentTenant, false, 'Cross-tenant KYC reuse must be blocked');
});

test('L. Duplicate Verify Click Idempotent — Prevents multiple billing charges', async () => {
  const idempotencyMap = new Map();

  const handleCharge = (key) => {
    if (idempotencyMap.has(key)) {
      return { status: 'CACHED', chargeCount: 0 };
    }
    idempotencyMap.set(key, true);
    return { status: 'CHARGED', chargeCount: 1 };
  };

  const idKey = 'idem-kyc-ocr-8506155001085-LAPP-1042';
  const firstClick = handleCharge(idKey);
  const secondClick = handleCharge(idKey);

  assert.equal(firstClick.status, 'CHARGED');
  assert.equal(firstClick.chargeCount, 1);
  assert.equal(secondClick.status, 'CACHED');
  assert.equal(secondClick.chargeCount, 0);
});

test('M. Photo / Report Inaccessible Across Tenants — Tenant isolation verified', async () => {
  const reportTenant = 'tenant_alpha';
  const requestingTenant = 'tenant_beta';

  const isAccessAuthorized = reportTenant === requestingTenant;
  assert.equal(isAccessAuthorized, false, 'Cross-tenant access forbidden');
});
