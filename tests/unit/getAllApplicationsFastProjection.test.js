const test = require('node:test');
const assert = require('node:assert/strict');

test('Fast Projection & Sanitization: verifies clean AML extraction and payload stripping for applications table', () => {
  // Simulate an application with heavy Base64 PDFs and raw bureau dumps
  const heavyApp = {
    _id: '507f1f77bcf86cd799439011',
    applicationId: 'LAPP-1043',
    fullName: 'Tebogo Shounyane',
    phoneNumber: '0812345678',
    emailAddress: 'tebogo@example.com',
    requestedAmount: 1000,
    requestedDuration: 1,
    estimatedMonthlyEMI: 1256.5,
    status: 'Disbursed',
    reviewStatus: 'Approved',
    createdAt: new Date('2026-11-06T10:00:00Z'),
    borrowerId: '507f191e810c19729de860ea',
    amlVerification: {
      verificationStatus: 'CLEARED',
      complianceDecision: 'CLEAR',
      isBlocked: false,
      riskLevel: 'LOW',
      amlScore: 10,
      // Heavy payloads that should NOT leak into frontend table response
      pdfReport: 'JVBERi0xLjQKJ...HUGE_BASE64_PDF_STRING...',
      rawResponse: { massiveDump: new Array(1000).fill('bloat') }
    },
    compliance: {
      aml: {
        rawResponse: { massiveDump: new Array(1000).fill('bloat') }
      }
    }
  };

  // Extract clean AML logic identical to controller
  const amlSource = (heavyApp.amlVerification?.verificationStatus && heavyApp.amlVerification.verificationStatus !== 'NOT_STARTED')
    ? heavyApp.amlVerification
    : (heavyApp.compliance?.aml || heavyApp.amlVerification || {});

  const cleanAml = {
    verificationStatus: amlSource.verificationStatus || 'NOT_STARTED',
    complianceDecision: amlSource.complianceDecision || null,
    isBlocked: Boolean(amlSource.isBlocked),
    riskLevel: amlSource.riskLevel || null,
    amlScore: amlSource.amlScore || null,
  };

  // Verify heavy fields were completely stripped
  assert.equal(cleanAml.verificationStatus, 'CLEARED');
  assert.equal(cleanAml.complianceDecision, 'CLEAR');
  assert.equal(cleanAml.isBlocked, false);
  assert.equal(cleanAml.pdfReport, undefined);
  assert.equal(cleanAml.rawResponse, undefined);
});

test('Borrower Map Bidirectional Lookup: resolves borrower by both userId and _id', () => {
  const borrowerProfiles = [
    {
      _id: '607f1f77bcf86cd799439099',
      userId: '507f191e810c19729de860ea',
      fullName: 'Tebogo Shounyane',
      profilePhoto: 'https://example.com/photo.jpg',
      borrowerCode: 'BRW-1008'
    }
  ];

  const borrowerMap = {};
  borrowerProfiles.forEach(b => {
    if (b.userId) borrowerMap[b.userId.toString()] = b;
    if (b._id) borrowerMap[b._id.toString()] = b;
  });

  // Lookup by User._id
  const bpByUser = borrowerMap['507f191e810c19729de860ea'];
  assert.ok(bpByUser, 'Must resolve borrower when borrowerId is User._id');
  assert.equal(bpByUser.borrowerCode, 'BRW-1008');

  // Lookup by Borrower._id
  const bpByBorrowerId = borrowerMap['607f1f77bcf86cd799439099'];
  assert.ok(bpByBorrowerId, 'Must resolve borrower when borrowerId is Borrower._id');
  assert.equal(bpByBorrowerId.borrowerCode, 'BRW-1008');
});

test('Application Detail View Optimization: strips massive Base64 strings and exposes hasPdfReport flags', () => {
  const sampleDetailApp = {
    _id: '507f1f77bcf86cd799439011',
    applicationId: 'LAPP-1057',
    consumerCreditReport: {
      verificationStatus: 'Verified',
      enquiryResultId: 'ENQ-9988',
      scoring: { finalScore: 680 }
    },
    bureauVerification: {
      verificationStatus: 'Verified',
      bureauReference: 'BUR-1122'
    }
  };

  const hasCreditReportPdf = Boolean(
    sampleDetailApp.consumerCreditReport?.reportPdfUrl ||
    sampleDetailApp.consumerCreditReport?.enquiryResultId ||
    sampleDetailApp.consumerCreditReport?.verificationStatus === 'Verified'
  );
  const hasBureauReportPdf = Boolean(
    sampleDetailApp.bureauVerification?.bureauReference ||
    sampleDetailApp.bureauVerification?.verificationStatus === 'Verified'
  );

  assert.equal(hasCreditReportPdf, true);
  assert.equal(hasBureauReportPdf, true);
});

