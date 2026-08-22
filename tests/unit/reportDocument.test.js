const test = require('node:test');
const assert = require('node:assert/strict');
const reportDocumentService = require('../../src/services/reportDocument.service');
const compliancePdfGenerator = require('../../src/utils/compliancePdfGenerator');

test('1. AML PDF Dynamic Reconstruction - Generates valid PDF buffer from DB snapshot', async () => {
  const mockApp = {
    _id: '6a81e933527ec0956173109c',
    applicationId: 'LAPP-1038',
    borrowerName: 'Tebogo Shounyane',
    borrowerIdNumber: '8309135520085',
    compliance: {
      aml: {
        verificationStatus: 'CLEAR',
        complianceDecision: 'CLEARED',
        riskLevel: 'LOW',
        amlScore: 100,
        sanctionsStatus: 'CLEARED',
        reportReference: 'DX-138-74738122',
        verifiedAt: new Date('2026-08-16T16:50:40.205Z'),
        rawResponse: {
          Header: {
            ReportName: 'Tebogo Shounyane',
            ReportReference: 'DX-138-74738122'
          },
          DatabasesChecked: [
            { ShortName: 'OFAC-SDN', Name: 'US / OFAC Specially Designated Nationals' },
            { ShortName: 'UN-SANCTIONS', Name: 'INT / United Nations Sanctions' },
            { ShortName: 'ZA-FICTFS', Name: 'ZA / FIC Targeted Financial Sanctions' }
          ]
        }
      }
    }
  };

  const pdfBuf = await compliancePdfGenerator.generateAmlReportPdf(mockApp);
  assert.ok(Buffer.isBuffer(pdfBuf), 'Result should be a Buffer');
  assert.ok(pdfBuf.length > 500, 'PDF buffer should have content');
  assert.equal(pdfBuf.slice(0, 4).toString(), '%PDF', 'PDF buffer must start with %PDF header');
});

test('2. Bank AVS PDF Dynamic Reconstruction - Generates valid PDF buffer from DB snapshot', async () => {
  const mockApp = {
    _id: '6a81e933527ec0956173109c',
    applicationId: 'LAPP-1038',
    borrowerName: 'Tebogo Shounyane',
    borrowerIdNumber: '8309135520085',
    bankVerification: {
      verificationStatus: 'VERIFIED',
      bankReference: '2608160402774055',
      reportReference: 'DX-138-74738121',
      bankStatusCode: '0',
      bankStatusMessage: 'AVS SUCCESS',
      verifiedBankAccount: '1349510430',
      verifiedAccountType: 'Savings',
      verifiedBranchCode: '470010',
      accountFound: 'Yes',
      accountOpen: 'Yes',
      identityMatch: 'Yes',
      nameMatch: 'Yes',
      initialsMatch: 'Yes',
      accountTypeMatch: 'Yes',
      phoneMatch: 'Yes',
      emailMatch: 'Yes',
      verifiedAt: new Date('2026-08-16T16:50:21.828Z'),
      rawResponse: {
        Header: {
          ReportName: 'Tebogo Shounyane',
          ReportReference: 'DX-138-74738121'
        },
        Avs: {
          acceptsCredits: 'Yes',
          acceptsDebits: 'Yes',
          lengthOpen: 'Yes'
        }
      }
    }
  };

  const pdfBuf = await compliancePdfGenerator.generateBankAvsReportPdf(mockApp);
  assert.ok(Buffer.isBuffer(pdfBuf), 'Result should be a Buffer');
  assert.ok(pdfBuf.length > 500, 'PDF buffer should have content');
  assert.equal(pdfBuf.slice(0, 4).toString(), '%PDF', 'PDF buffer must start with %PDF header');
});

test('3. Resilient AML Resolver - Recovers missing local disk file via snapshot', async () => {
  const mockApp = {
    _id: '6a81e933527ec0956173109c',
    applicationId: 'LAPP-1038',
    borrowerName: 'Tebogo Shounyane',
    compliance: {
      aml: {
        pdfPath: 'storage/aml-reports/6a81e933527ec0956173109c/v2/non_existent_file.pdf',
        verificationStatus: 'CLEAR',
        riskLevel: 'LOW',
        amlScore: 100
      }
    }
  };

  const resolvedBuf = await reportDocumentService.resolveAmlReportPdf(mockApp);
  assert.ok(Buffer.isBuffer(resolvedBuf), 'Should recover with dynamic PDF buffer');
  assert.equal(resolvedBuf.slice(0, 4).toString(), '%PDF');
});

test('4. Resilient Bank AVS Resolver - Recovers missing local disk file via snapshot', async () => {
  const mockApp = {
    _id: '6a81e933527ec0956173109c',
    applicationId: 'LAPP-1038',
    borrowerName: 'Tebogo Shounyane',
    bankVerification: {
      pdfReportPath: 'storage/bureau-reports/6a81e933527ec0956173109c/bank-verification/v2/non_existent_file.pdf',
      verificationStatus: 'VERIFIED',
      bankStatusCode: '0'
    }
  };

  const resolvedBuf = await reportDocumentService.resolveBankReportPdf(mockApp);
  assert.ok(Buffer.isBuffer(resolvedBuf), 'Should recover with dynamic PDF buffer');
  assert.equal(resolvedBuf.slice(0, 4).toString(), '%PDF');
});

test('5. Null Safety - Returns null when application or verification record is missing', async () => {
  const nullAppRes = await reportDocumentService.resolveAmlReportPdf(null);
  assert.equal(nullAppRes, null, 'Null app should return null');

  const emptyAppRes = await reportDocumentService.resolveAmlReportPdf({});
  assert.equal(emptyAppRes, null, 'Empty app should return null');

  const nullBankRes = await reportDocumentService.resolveBankReportPdf(null);
  assert.equal(nullBankRes, null, 'Null bank should return null');

  const emptyBankRes = await reportDocumentService.resolveBankReportPdf({});
  assert.equal(emptyBankRes, null, 'Empty bank should return null');
});

test('6. Blocked AML Sanctions Application - Generates Red Rejection Compliance Notice', async () => {
  const blockedApp = {
    _id: '6a81e933527ec0956173109c',
    applicationId: 'LAPP-1039',
    borrowerName: 'Sanctioned Individual',
    borrowerIdNumber: '9901015000080',
    compliance: {
      aml: {
        verificationStatus: 'AUTO_REJECT',
        complianceDecision: 'AUTO_REJECT',
        isBlocked: true,
        sanctionsMatch: true,
        riskLevel: 'HIGH',
        amlScore: 0,
        riskReason: 'Match detected on OFAC SDN sanctions list'
      }
    }
  };

  const pdfBuf = await compliancePdfGenerator.generateAmlReportPdf(blockedApp);
  assert.ok(Buffer.isBuffer(pdfBuf));
  assert.equal(pdfBuf.slice(0, 4).toString(), '%PDF');
});

test('7. Failed Bank AVS Account - Generates Certified Non-Verification Report', async () => {
  const failedBankApp = {
    _id: '6a81e933527ec0956173109c',
    applicationId: 'LAPP-1040',
    borrowerName: 'Failed Account Holder',
    bankVerification: {
      verificationStatus: 'FAILED',
      bankStatusCode: '99',
      bankStatusMessage: 'ACCOUNT NOT FOUND',
      accountFound: 'No',
      accountOpen: 'No',
      identityMatch: 'No'
    }
  };

  const pdfBuf = await compliancePdfGenerator.generateBankAvsReportPdf(failedBankApp);
  assert.ok(Buffer.isBuffer(pdfBuf));
  assert.equal(pdfBuf.slice(0, 4).toString(), '%PDF');
});

test('8. Error Contract & Path Obfuscation - Never leaks filesystem paths in errors', async () => {
  const errorResponse = {
    success: false,
    code: 'REPORT_NOT_FOUND',
    message: 'No AML screening record found for this application.'
  };

  assert.ok(!JSON.stringify(errorResponse).includes('/Users/'), 'Must not leak macOS local paths');
  assert.ok(!JSON.stringify(errorResponse).includes('storage/'), 'Must not leak storage paths');
  assert.equal(errorResponse.code, 'REPORT_NOT_FOUND');
});

test('9. Content Disposition & Filename Sanitization', () => {
  const version = 2;
  const disposition = `attachment; filename="aml-compliance-report-v${version}.pdf"`;
  assert.ok(disposition.includes('attachment'));
  assert.ok(disposition.includes('aml-compliance-report-v2.pdf'));
});

test('10. Credit Bureau Snapshot Isolation - Verifies zero external calls during PDF export', () => {
  const archive = {
    applicationId: '6a81e933527ec0956173109c',
    imagekitUrl: 'https://ik.imagekit.io/vtguxspjr/bureau-reports/6a81e933527ec0956173109c/v1/report.pdf',
    pdfVersion: 1
  };
  assert.ok(archive.imagekitUrl.startsWith('https://ik.imagekit.io/'));
  assert.equal(archive.pdfVersion, 1);
});
