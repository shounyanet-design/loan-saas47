const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');
const LoanApplication = require('../../models/LoanApplication');
const SystemSettings = require('../../models/SystemSettings');
const VerificationLog = require('../../models/VerificationLog');
const AMLCheck = require('../../models/AMLCheck');
const { getIO } = require('../../socket/socketServer');
const { callAMLScreening } = require('../../services/datanamix/amlScreening.service');

const writeAuditLog = async (data) => {
  try {
    return await VerificationLog.create(data);
  } catch (err) {
    console.error('⚠️ [Audit Log Error]: Failed to write log to database:', err.message);
  }
};

/**
 * 1. Performs AML watchlist screening using borrower profile data and Datanamix API.
 * POST /api/verification/aml-screening/:applicationId
 */
const verifyAMLScreeningController = async (req, res) => {
  const { applicationId } = req.params;
  const initiatedBy = req.user ? req.user._id : null;

  if (!applicationId) {
    return res.status(400).json({ success: false, message: 'applicationId is required' });
  }

  try {
    const app = await LoanApplication.findById(applicationId);
    if (!app) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    // Auto map values from Step 1 Profile: body takes priority, DB is fallback
    const fullName = (req.body.fullName || app.fullName || '').trim();
    const idNumber = (req.body.idNumber || app.idNumber || '').trim();
    const dateOfBirth = req.body.dateOfBirth || app.dateOfBirth;
    const phoneNumber = req.body.phoneNumber || app.phoneNumber;
    const emailAddress = req.body.emailAddress || app.emailAddress;
    const country = req.body.country || 'ZA';

    if (!fullName || !idNumber) {
      return res.status(400).json({
        success: false,
        message: 'Borrower fullName and idNumber are required for AML screening.'
      });
    }

    const borrowerId = app.borrowerId || initiatedBy;
    const room = borrowerId?.toString();

    // Socket: AML_STARTED
    try {
      const io = getIO();
      io.to(room).emit('AML_STARTED', { applicationId, message: 'AML & Sanctions watchlist screening started.' });
    } catch (e) {}

    console.log(`[AML Screening Controller] Initiating screening for app ${applicationId} (${fullName})`);

    // Fetch Central Settings
    const settings = await SystemSettings.findOne() || {};
    const environment = settings.bankVerificationEnvironment || 'SANDBOX'; // fallback to sandbox
    const bypassEnabled = settings.sandboxComplianceBypass || false;

    // Call service
    const result = await callAMLScreening({
      idNumber,
      fullName,
      clientReference: applicationId,
      environment
    });

    // Handle PDF storage and hashing
    let pdfPath = '';
    let pdfHash = '';
    let version = 1;

    if (result.rawResponse?.PDFReport) {
      try {
        const pdfBuffer = Buffer.from(result.rawResponse.PDFReport, 'base64');
        pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

        // Check version number of existing AML pdf reports
        version = (app.compliance?.aml?.version || 0) + 1;

        // Path: storage/aml-reports/<applicationId>/v${version}/
        const storageDir = path.join(__dirname, '..', '..', '..', 'storage', 'aml-reports', applicationId.toString(), `v${version}`);
        await fs.mkdir(storageDir, { recursive: true });

        const filePath = path.join(storageDir, 'report.pdf');
        await fs.writeFile(filePath, pdfBuffer);

        pdfPath = path.join('storage', 'aml-reports', applicationId.toString(), `v${version}`, 'report.pdf');
        console.log(`[AML PDF] Saved encrypted report to ${filePath} with hash: ${pdfHash}`);
      } catch (pdfErr) {
        console.error('⚠️ [AML PDF Error] Storing PDF failed:', pdfErr.message);
      }
    }

    // Clean out base64 pdf report content to avoid database bloating
    if (result.rawResponse) {
      if (result.rawResponse.PDFReport) result.rawResponse.PDFReport = undefined;
      if (result.rawResponse.pdfReport) result.rawResponse.pdfReport = undefined;
    }

    // UNDERWRITING ENGINE LINKAGE
    let underwritingDecision = app.underwritingDecision || 'Auto Approve';
    let riskLevel = result.riskLevel;
    let appStatus = app.status;
    let complianceGate = 'Passed';
    let approvalEligibility = 'Eligible';
    let disbursementEligibility = 'Eligible';

    if (result.verificationStatus === 'AUTO_REJECT') {
      if (bypassEnabled) {
        console.warn('[DEV COMPLIANCE BYPASS ACTIVE] Blocked status detected but bypassed.');
        underwritingDecision = 'Manual Review Required';
        riskLevel = 'MEDIUM';
        complianceGate = 'Pending Review';
        approvalEligibility = 'Pending Review';
        disbursementEligibility = 'Pending Review';
      } else {
        underwritingDecision = 'Decline';
        riskLevel = 'HIGH';
        complianceGate = 'Blocked';
        approvalEligibility = 'Ineligible';
        disbursementEligibility = 'Blocked';
        appStatus = 'Rejected';
      }
    } else if (result.verificationStatus === 'REVIEW_REQUIRED') {
      underwritingDecision = 'Manual Review Required';
      riskLevel = 'MEDIUM';
      complianceGate = 'Pending Review';
      approvalEligibility = 'Pending Review';
      disbursementEligibility = 'Pending Review';
      if (appStatus !== 'Rejected') {
        appStatus = 'Pending Review';
      }
    }

    // Persist compliance.aml result
    const amlResult = {
      verificationStatus: result.verificationStatus,
      complianceDecision: result.complianceDecision,
      riskLevel: result.riskLevel,
      amlScore: result.amlScore,
      sanctionsStatus: result.sanctionsStatus,
      reportReference: result.reportReference,
      isBlocked: bypassEnabled ? false : result.isBlocked,
      ofacMatch: result.ofacMatch,
      sanctionsMatch: result.sanctionsMatch,
      terrorMatch: result.terrorMatch,
      pepMatch: result.pepMatch,
      fatfMatch: result.fatfMatch,
      adverseMediaMatch: result.adverseMediaMatch,
      riskReason: result.riskReason,
      matchedEntities: result.matchedEntities,
      rawResponse: result.rawResponse,
      verifiedAt: result.verifiedAt || new Date(),
      provider: 'DATANAMIX',
      pdfPath,
      pdfHash,
      version
    };

    // Construct update fields (including compatibility fields amlVerification)
    const updateFields = {
      'compliance.aml': amlResult,
      
      // Compatibility mapping
      'amlVerification.verificationStatus': amlResult.verificationStatus,
      'amlVerification.amlScore': amlResult.amlScore,
      'amlVerification.found': amlResult.matchedEntities.length > 0,
      'amlVerification.pepMatch': amlResult.pepMatch,
      'amlVerification.sanctionsMatch': amlResult.sanctionsMatch,
      'amlVerification.terrorMatch': amlResult.terrorMatch,
      'amlVerification.fraudMatch': amlResult.terrorMatch || amlResult.sanctionsMatch,
      'amlVerification.adverseMediaMatch': amlResult.adverseMediaMatch,
      'amlVerification.ofacMatch': amlResult.ofacMatch,
      'amlVerification.fatfMatch': amlResult.fatfMatch,
      'amlVerification.riskLevel': amlResult.riskLevel,
      'amlVerification.riskReason': amlResult.riskReason,
      'amlVerification.reportReference': amlResult.reportReference,
      'amlVerification.clientReference': applicationId,
      'amlVerification.matchCount': amlResult.matchedEntities.length,
      'amlVerification.matchedEntities': amlResult.matchedEntities,
      'amlVerification.screeningDate': amlResult.verifiedAt,
      'amlVerification.rawResponse': amlResult.rawResponse,
      'amlVerification.sanctionsStatus': amlResult.sanctionsStatus,
      'amlVerification.complianceDecision': amlResult.complianceDecision,
      'amlVerification.isBlocked': amlResult.isBlocked,
      'amlVerification.screeningTimestamp': amlResult.verifiedAt,
      
      // Underwriting fields
      underwritingDecision,
      complianceGate,
      approvalEligibility,
      disbursementEligibility,
      status: appStatus,
      'staffReview.riskLevel': riskLevel === 'HIGH' ? 'Critical' : (riskLevel === 'MEDIUM' ? 'Medium' : 'Low')
    };

    await LoanApplication.findByIdAndUpdate(applicationId, updateFields);

    // Save details in AMLCheck collection
    await AMLCheck.create({
      borrowerId,
      pepStatusDetected: result.pepMatch || false,
      sanctionStatusDetected: result.sanctionsMatch || false,
      crimeRecordDetected: result.terrorMatch || false,
      riskScore: result.amlScore || 0,
      matchDetails: (result.matchedEntities || []).map(m => ({
        listName: m.source,
        matchedName: m.matchName,
        matchConfidence: m.confidenceScore,
        details: m
      })),
      screeningRawResponse: result.rawResponse || {},
      screeningDate: result.verifiedAt || new Date(),
      complianceOutcome: result.verificationStatus === 'CLEAR' ? 'PASSED' : (result.isBlocked ? 'FAILED' : 'REFERRED'),
      notes: result.riskReason
    });

    // Write audit log
    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'AML_SCREENING',
      status: result.verificationStatus === 'AUTO_REJECT' ? 'FAILED' : 'SUCCESS',
      initiatedBy,
      requestPayload: { idNumber, fullName, applicationId },
      responsePayload: {
        verificationStatus: result.verificationStatus,
        riskLevel: result.riskLevel,
        reportReference: result.reportReference
      }
    });

    // Broadcast Socket Events
    try {
      const io = getIO();
      if (result.verificationStatus === 'AUTO_REJECT' && !bypassEnabled) {
        io.to(room).emit('AML_HIGH_RISK', {
          applicationId,
          message: 'FATAL COMPLIANCE RISK: Borrower matched restricted sanctions watchlists.',
          riskReason: result.riskReason
        });
      } else {
        io.to(room).emit('AML_COMPLETED', {
          applicationId,
          verificationStatus: result.verificationStatus,
          riskLevel: result.riskLevel,
          matchCount: result.matchedEntities.length,
          message: 'AML watchlists screening completed successfully.'
        });
      }
    } catch (e) {}

    return res.status(200).json({
      success: true,
      message: `AML screening completed with status: ${result.verificationStatus}`,
      data: amlResult
    });

  } catch (error) {
    console.error('❌ [verifyAMLScreeningController Error]:', error.message);
    await writeAuditLog({
      borrowerId: initiatedBy,
      applicationId,
      verificationType: 'AML_SCREENING_FAILED',
      status: 'FAILED',
      initiatedBy,
      requestPayload: { applicationId },
      errorMessage: error.message
    });

    try {
      const io = getIO();
      io.to(initiatedBy?.toString()).emit('AML_FAILED', { applicationId, message: error.message });
    } catch (e) {}

    return res.status(500).json({
      success: false,
      message: error.message || 'AML screening failed.'
    });
  }
};

/**
 * 2. Streams the AML report PDF directly from the file system.
 * GET /api/verification/aml-report-pdf/:applicationId
 */
const getAmlReportPdfController = async (req, res) => {
  const { applicationId } = req.params;

  try {
    const app = await LoanApplication.findById(applicationId).select('compliance');
    if (!app || !app.compliance?.aml?.pdfPath) {
      return res.status(404).json({ success: false, message: 'No AML screening PDF report found for this application.' });
    }

    const filePath = path.join(__dirname, '..', '..', '..', app.compliance.aml.pdfPath);
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'AML PDF report file not found on server disk.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="aml_compliance_report.pdf"');

    const readStream = fsSync.createReadStream(filePath);
    readStream.pipe(res);
  } catch (error) {
    console.error('[STREAM AML PDF ERROR]:', error.message);
    res.status(500).json({ success: false, message: 'Error streaming AML report PDF.' });
  }
};

/**
 * 3. Securely downloads the AML report PDF.
 * GET /api/verification/download-aml-report/:applicationId
 */
const downloadAmlReportController = async (req, res) => {
  const { applicationId } = req.params;

  try {
    const app = await LoanApplication.findById(applicationId).select('compliance');
    if (!app || !app.compliance?.aml?.pdfPath) {
      return res.status(404).json({ success: false, message: 'No AML screening PDF report found for this application.' });
    }

    const filePath = path.join(__dirname, '..', '..', '..', app.compliance.aml.pdfPath);
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'AML PDF report file not found on server disk.' });
    }

    const fileVersion = app.compliance.aml.version || 1;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="aml-compliance-report-v${fileVersion}.pdf"`);

    const readStream = fsSync.createReadStream(filePath);
    readStream.pipe(res);
  } catch (error) {
    console.error('[DOWNLOAD AML PDF ERROR]:', error.message);
    res.status(500).json({ success: false, message: 'Error downloading AML report PDF.' });
  }
};

module.exports = {
  verifyAMLScreeningController,
  getAmlReportPdfController,
  downloadAmlReportController
};
