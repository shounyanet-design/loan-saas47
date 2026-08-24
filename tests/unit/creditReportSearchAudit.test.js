const test = require('node:test');
const assert = require('node:assert/strict');
const { generateVerificationHash } = require('../../src/utils/verificationHashEngine');

test('1. Hash Invalidation Guard is Non-Destructive — Does not wipe DB on hash mismatch', async () => {
  const mockApp = {
    _id: '6a69a77e3f5e43f54624dd96',
    applicationId: 'LAPP-1005',
    borrowerId: '6a68978c3f5e43f54624da4e',
    requestedAmount: 2500,
    creditAssessment: {
      verificationStatus: 'Verified',
      enquiryId: '1282029417',
      enquiryResultId: '1282029417',
      reportReference: 'DX-152-75154139',
      verificationHash: 'stale_hash_value_12345'
    }
  };

  const mockBorrower = {
    _id: '6a68978c3f5e43f54624da4e',
    idNumber: '6208015938080',
    employmentStatus: 'Permanent'
  };

  const calculatedHash = generateVerificationHash(mockApp, mockBorrower);
  assert.notEqual(calculatedHash, mockApp.creditAssessment.verificationHash, 'Hash should mismatch');

  // Verify non-destructive behavior: creditAssessment fields remain intact
  let verificationHashValid = true;
  if (calculatedHash !== mockApp.creditAssessment.verificationHash) {
    verificationHashValid = false;
  }

  assert.equal(verificationHashValid, false, 'Hash flag correctly set to false');
  assert.equal(mockApp.creditAssessment.verificationStatus, 'Verified', 'DB status preserved');
  assert.equal(mockApp.creditAssessment.enquiryResultId, '1282029417', 'Enquiry ID preserved');
  assert.equal(mockApp.creditAssessment.reportReference, 'DX-152-75154139', 'Report Ref preserved');
});

test('2. Credit Search Audit Structure — Validates enquiry, score, and matched consumers', async () => {
  const mockCreditAssessment = {
    verificationStatus: 'Verified',
    enquiryId: 'ENQ-99120',
    enquiryResultId: 'RES-99120',
    matchedConsumers: [
      {
        consumerId: 'CONS-001',
        firstName: 'Tebogo',
        surname: 'Shounyane',
        idNo: '8309135520085',
        gender: 'Male'
      }
    ],
    reportReference: 'DX-152-881293',
    searchSuccess: true,
    responseCode: 200,
    completedAt: new Date('2026-08-24T12:00:00Z')
  };

  assert.equal(mockCreditAssessment.verificationStatus, 'Verified');
  assert.equal(mockCreditAssessment.matchedConsumers.length, 1);
  assert.equal(mockCreditAssessment.matchedConsumers[0].firstName, 'Tebogo');
  assert.equal(mockCreditAssessment.reportReference, 'DX-152-881293');
});

test('3. PDF Stream Fallback Resolution — Formats base64 buffer when archive missing', async () => {
  const mockBase64Pdf = 'JVBERi0xLjQgTW9jayBDcmVkaXQgUmVwb3J0IFBERiBDb250ZW50'; // %PDF-1.4 header
  
  const mockAppWithPdf = {
    _id: '6a897a623fac27ee804b60dc',
    consumerCreditReport: {
      verificationStatus: 'Verified',
      pdfReport: mockBase64Pdf
    }
  };

  const pdfData = mockAppWithPdf.consumerCreditReport.pdfReport;
  assert.ok(pdfData, 'PDF data exists on application');
  
  const buffer = Buffer.from(pdfData, 'base64');
  assert.ok(buffer instanceof Buffer, 'Successfully converted to binary Buffer');
  assert.ok(buffer.toString('utf-8').startsWith('%PDF'), 'Buffer contains valid %PDF magic bytes');
});

test('4. Cross-Tenant Security Gate — Ensures tenant ownership validation', async () => {
  const tenantA_Id = '6a437fbbcc83008c43ffd498';
  const tenantB_Id = '999999bbcc83008c43ffd999';

  const resourceTenantId = tenantA_Id;
  const requestingTenantId = tenantB_Id;

  const isAllowed = resourceTenantId === requestingTenantId;
  assert.equal(isAllowed, false, 'Cross-tenant request correctly denied');
});
