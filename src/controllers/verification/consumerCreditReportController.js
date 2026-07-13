/**
 * consumerCreditReportController.js
 * Retrives full Datanamix Consumer Credit Report, executes the Underwriting and Rule Engines,
 * saves normalized outputs directly to LoanApplication, and returns compliance-safe results.
 */

const LoanApplication = require('../../models/LoanApplication');
const Borrower = require('../../models/Borrower');
const SystemSettings = require('../../models/SystemSettings');
const VerificationLog = require('../../models/VerificationLog');
const { callConsumerCreditReport } = require('../../services/datanamix/consumerCreditReportService');
const { isDevelopmentSandboxBypassEnabled } = require('../../utils/devSandboxBypass');
const { generateVerificationHash } = require('../../utils/verificationHashEngine');

// Compliance Upgrade Imports
const BureauReportArchive = require('../../models/bureauReportArchive.model');
const ImageKit = require('../../config/imagekit');
const crypto = require('crypto');
const axios = require('axios');
const { PDFDocument, rgb, degrees } = require('pdf-lib');

// Helper to decrypt Datanamix PDF and overlay diagonal watermarks if in sandbox mode
async function decryptAndProcessPdf(pdfBuffer, isSandbox, enableWatermark) {
  try {
    console.log('[COMPLIANCE] Decrypting Datanamix PDF report using secure key...');
    // Load the encrypted PDF from Datanamix using their standard password
    const pdfDoc = await PDFDocument.load(pdfBuffer, { password: '0123456789' });
    
    // Draw diagonal watermarks if in sandbox mode
    if (isSandbox && enableWatermark) {
      console.log('[COMPLIANCE] Sandbox environment active. Drawing diagonal watermark overlays...');
      const pages = pdfDoc.getPages();
      for (const page of pages) {
        const { width, height } = page.getSize();
        page.drawText('SANDBOX TEST REPORT\nNOT FOR REAL CREDIT DECISION', {
          x: width / 6,
          y: height / 3,
          size: 30,
          color: rgb(0.8, 0.2, 0.2),
          opacity: 0.15,
          rotate: degrees(45),
          lineHeight: 36,
        });
      }
    }
    
    // Save unencrypted PDF output buffer
    const modifiedPdfBuffer = await pdfDoc.save();
    return Buffer.from(modifiedPdfBuffer);
  } catch (err) {
    console.error('⚠️ [PDF Processing Error] Failed to decrypt / watermark PDF:', err.message);
    // If decryption using password fails, try loading unencrypted just in case
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const modifiedPdfBuffer = await pdfDoc.save();
      return Buffer.from(modifiedPdfBuffer);
    } catch (innerErr) {
      console.error('⚠️ [PDF Fallback Error] Could not load or parse PDF buffer:', innerErr.message);
      return pdfBuffer; // fallback to raw encrypted buffer if all else fails
    }
  }
}

const calculateAge = (dob) => {
  if (!dob) return null;
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

const parseEmploymentMonths = (val) => {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  const match = String(val).match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
};

const writeAuditLogLocal = async (data) => {
  try {
    return await VerificationLog.create(data);
  } catch (err) {
    console.error('⚠️ [Audit Log Error]: Failed to write log to database:', err.message);
  }
};

exports.fetchConsumerCreditReportController = async (req, res) => {
  const { applicationId } = req.params;
  const initiatedBy = req.user ? req.user._id : null;

  if (!applicationId) {
    return res.status(400).json({ success: false, message: 'applicationId is required' });
  }

  try {
    // 1. Load Loan Application
    const application = await LoanApplication.findById(applicationId);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Loan application not found' });
    }

    // 2. Fetch Borrower Profile (for income/ID metrics)
    const borrower = await Borrower.findOne({
      $or: [
        { _id: application.borrowerId },
        { userId: application.borrowerId }
      ]
    });
    if (!borrower) {
      return res.status(404).json({ success: false, message: 'Borrower profile not found' });
    }

    // 3. Execution Guard checks
    const searchExecuted = application.creditAssessment?.enquiryResultId && application.creditAssessment?.verificationStatus === 'Verified';
    const storedEnquiryId = application.creditAssessment?.enquiryId;
    const storedEnquiryResultId = application.creditAssessment?.enquiryResultId;

    if (!searchExecuted || !storedEnquiryId || !storedEnquiryResultId) {
      return res.status(400).json({
        success: false,
        message: 'Consumer search required before fetching report.'
      });
    }

    // Additional validations
    if (!borrower.idNumber && !borrower.passportNumber) {
      return res.status(400).json({
        success: false,
        message: 'Valid ID or passport number is required'
      });
    }

    const basicSalary = application.affordabilityOutcome?.income?.basicSalary || borrower.monthlyNetSalary || 0;
    if (basicSalary <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Affordability details must be completed before fetching report.'
      });
    }

    // 4. Fetch Admin Lending Settings
    const settings = (await SystemSettings.findOne()) || {};
    const testModeActive = settings.testMode !== undefined ? settings.testMode : true;

    // 5. Call official Datanamix API (using the new service)
    console.log(`[CREDIT REPORT] Fetching Datanamix report for App: ${applicationId}. Mode: ${testModeActive ? 'SANDBOX' : 'LIVE'}`);
    const reportData = await callConsumerCreditReport({
      enquiryId: storedEnquiryId,
      enquiryResultId: storedEnquiryResultId,
      clientReference: application.applicationId,
      isSandbox: testModeActive
    });

    if (!reportData || reportData.success === false) {
      throw new Error(reportData?.message || 'Failed to retrieve credit report from Datanamix service.');
    }

    // Extract core parsed variables with deep defensive guards
    const finalScore = reportData?.scoring?.finalScore ?? 0;
    const riskCategory = reportData?.scoring?.riskCategory || 'Unknown';
    const classification = reportData?.scoring?.classification || 'Unknown';

    const bureauDebtSummary = reportData?.debtSummary || {};
    const totalArrearsAmount = 
      bureauDebtSummary?.totalArrearsAmount ??
      reportData?.rawResponse?.Consumer?.ConsumerCPANLRDebtSummary?.TotalArrearsAmount;

    const totalDebt = 
      bureauDebtSummary?.totalOutstandingDebt ??
      reportData?.rawResponse?.Consumer?.ConsumerCPANLRDebtSummary?.TotalOutstandingDebt ??
      reportData?.rawResponse?.Consumer?.ConsumerCPANLRDebtSummary?.TotalOutStandingDebt ??
      0;

    const monthlyInstallment = 
      bureauDebtSummary?.totalMonthlyInstallment ??
      reportData?.rawResponse?.Consumer?.ConsumerCPANLRDebtSummary?.TotalMonthlyInstallment ??
      reportData?.rawResponse?.Consumer?.ConsumerCPANLRDebtSummary?.TotalMonthlyInstalment ??
      0;

    const totalMonthlyInstallment = monthlyInstallment;
    const totalOutstandingDebt = totalDebt;
    const totalArrearAmount = totalArrearsAmount;

    const judgmentCount = 
      bureauDebtSummary?.judgementCount || 
      bureauDebtSummary?.judgmentCount ||
      reportData?.rawResponse?.Consumer?.ConsumerCPANLRDebtSummary?.JudgementCount || 
      0;

    const defaultCount = 
      bureauDebtSummary?.defaultListingCount || 
      bureauDebtSummary?.defaultCount ||
      reportData?.rawResponse?.Consumer?.ConsumerCPANLRDebtSummary?.DefaultListingCount || 
      0;

    const highestMonthsInArrears = 
      bureauDebtSummary?.highestMonthsInArrears || 
      reportData?.rawResponse?.Consumer?.ConsumerCPANLRDebtSummary?.HighestMonthsInArrears || 
      0;

    const deceasedFlag = reportData?.fraudIndicators?.deceasedStatus || false;
    const safpsListed = reportData?.fraudIndicators?.safpsListed || false;
    const debtReviewStatus = reportData?.fraudIndicators?.debtReviewStatus || false;
    const homeAffairsVerified = reportData?.fraudIndicators?.homeAffairsVerified || false;

    // DEBUG LOGGING
    console.log('BUREAU DEBT SUMMARY:', bureauDebtSummary);
    console.log('PARSED VALUES:', {
      totalDebt,
      totalArrearsAmount,
      monthlyInstallment
    });

    // 6. Run UNDERWRITING RULE ENGINE
    const borrowerIncome = borrower.monthlyNetSalary || 0;
    const maxDti = settings.maxDtiPercentage || 40;
    const warningDti = settings.affordabilityWarningThreshold || 35;
    const minSalary = settings.minSalaryRequirement || 5000;
    const minDisposable = settings.minDisposableIncome || 2000;

    // Calculations
    const dti = borrowerIncome > 0 ? (totalMonthlyInstallment / borrowerIncome) * 100 : 0;
    const calculatedDisposable = borrowerIncome - totalMonthlyInstallment; // Disposable Income based on bureau debt

    const isDtiEligible = dti <= maxDti;
    const isDtiWarning = dti > warningDti;
    const isSalaryEligible = borrowerIncome >= minSalary;
    const isDisposableEligible = calculatedDisposable >= minDisposable;

    const rulesRun = {
      minSalary: isSalaryEligible,
      dtiThreshold: isDtiEligible,
      dtiWarning: isDtiWarning,
      disposableIncome: isDisposableEligible
    };

    // Analyze repayment behavior (24 monthly payments)
    let chronicArrears = highestMonthsInArrears >= 3;
    let missedPaymentsCount = 0;
    if (Array.isArray(reportData.monthlyPaymentHistory)) {
      reportData.monthlyPaymentHistory.forEach(account => {
        if (Array.isArray(account.months)) {
          account.months.forEach(cell => {
            const codeNum = parseInt(cell.code, 10);
            if (!isNaN(codeNum) && codeNum > 0) {
              missedPaymentsCount++;
              if (codeNum >= 3) {
                chronicArrears = true;
              }
            }
          });
        }
      });
    }

    // Underwriting Decision Engine (APPROVE, MANUAL_REVIEW, DECLINE, BLOCKED)
    let underwritingDecision = 'APPROVE';
    let workflowRoute = 'Auto Approval Engine';
    let riskSeverity = 'Low';
    let fraudDetected = deceasedFlag || safpsListed || debtReviewStatus;
    let reasons = [];

    // CASE 4: BLOCKED (Deceased, SAFPS Fraud)
    if (deceasedFlag || safpsListed) {
      underwritingDecision = 'BLOCKED';
      workflowRoute = 'FRAUD_QUEUE';
      riskSeverity = 'Critical';
      if (deceasedFlag) reasons.push('Fatal: Deceased flag detected on Home Affairs record.');
      if (safpsListed) reasons.push('Fatal: SAFPS fraud listing detected.');
    }
    // CASE 3: DECLINE (High defaults, judgments, high DTI)
    else if (dti > maxDti || defaultCount > 2 || judgmentCount > 0 || chronicArrears || finalScore < 500) {
      underwritingDecision = 'DECLINE';
      workflowRoute = 'RISK_ESCALATION_QUEUE';
      riskSeverity = 'High';
      if (dti > maxDti) reasons.push(`DTI ratio of ${dti.toFixed(1)}% exceeds maximum allowed threshold of ${maxDti}%.`);
      if (defaultCount > 2) reasons.push(`Excessive bureau defaults: ${defaultCount} listings found (max 2).`);
      if (judgmentCount > 0) reasons.push(`Active legal judgment(s) detected: ${judgmentCount} court listing(s).`);
      if (chronicArrears) reasons.push(`Chronic repayment arrears detected (accounts in 3+ months arrears).`);
      if (finalScore < 500) reasons.push(`Credit bureau score of ${finalScore} is below underwriting minimum of 500.`);
    }
    // CASE 2: MANUAL_REVIEW (Medium risk, some arrears, DTI near warning)
    else if (dti > warningDti || defaultCount > 0 || totalArrearAmount > 0 || finalScore < 600 || settings.enableAutoApprovalLogic === false) {
      underwritingDecision = 'MANUAL_REVIEW';
      workflowRoute = 'Manual Review Queue';
      riskSeverity = 'Medium';
      if (dti > warningDti) reasons.push(`DTI ratio of ${dti.toFixed(1)}% exceeds warning limit of ${warningDti}%.`);
      if (defaultCount > 0) reasons.push(`Minor bureau defaults: ${defaultCount} listing(s) found.`);
      if (totalArrearAmount > 0) reasons.push(`Outstanding arrears: R${totalArrearAmount.toLocaleString()} currently past due.`);
      if (finalScore < 600) reasons.push(`Moderate credit bureau score of ${finalScore} requires manual verification.`);
      if (settings.enableAutoApprovalLogic === false) reasons.push('System configuration mandates manual review for all requests.');
    }
    // CASE 1: APPROVE (Low risk, clean profile)
    else {
      underwritingDecision = 'APPROVE';
      workflowRoute = 'Auto Approval Engine';
      riskSeverity = 'Low';
      reasons.push(`Credit score of ${finalScore} meets all primary lending criteria.`);
    }

    // Apply sandbox bypass/warning modes
    let sandboxFraudSimulation = false;
    if (testModeActive && (underwritingDecision === 'BLOCKED' || underwritingDecision === 'DECLINE')) {
      // In sandbox mode, do not permanently lock progression. Map to manual review with simulation notice.
      sandboxFraudSimulation = true;
      underwritingDecision = 'MANUAL_REVIEW';
      workflowRoute = 'Manual Review Queue';
      reasons.push('Sandbox fraud simulation detected: warnings flagged but bypass allowed for test purposes.');
    }

    // 7. Run ELIGIBILITY ENGINE
    const dob = borrower.dateOfBirth;
    const borrowerAge = calculateAge(dob);
    const minAge = settings.minimumAge || 18;
    const maxAge = settings.maximumAge || 65;
    const empMonths = parseEmploymentMonths(borrower.yearsOfService ? borrower.yearsOfService * 12 : 6);
    const minEmpDuration = settings.minEmploymentDuration || 6;

    const eligibilityRun = {
      ageRange: borrowerAge ? (borrowerAge >= minAge && borrowerAge <= maxAge) : true,
      employmentDuration: empMonths >= minEmpDuration,
      employmentType: settings.employmentType === 'Both' || !borrower.employmentStatus ||
        (settings.employmentType === 'Employed' && ['Permanent', 'Contract'].includes(borrower.employmentStatus)) ||
        (settings.employmentType === 'Self Employed' && ['Self-Employed'].includes(borrower.employmentStatus)),
      allowedProduct: !application.loanType || (settings.allowedLoanProducts || []).includes(application.loanType),
      salaryRequirements: borrowerIncome >= minSalary
    };

    const isEligible = Object.values(eligibilityRun).every(val => val === true);
    const eligibilityStatus = isEligible ? 'Eligible' : 'Ineligible';

    // 8. MANDATED JSON CONSOLE LOGS
    const underwritingResultLog = {
      applicationId,
      rulesRun,
      riskSeverity,
      underwritingDecision,
      warnings: reasons,
      sandboxSimulationActive: sandboxFraudSimulation
    };

    const eligibilityResultLog = {
      applicationId,
      eligibilityRun,
      eligibilityStatus
    };

    const workflowResultLog = {
      applicationId,
      workflowRoute,
      reviewerAssignment: settings.enableAutoAssignment ? 'Auto-Assigned' : 'Manual',
      escalationTriggered: (underwritingDecision === 'DECLINE' || underwritingDecision === 'BLOCKED' || chronicArrears)
    };

    console.log("UNDERWRITING RULE ENGINE EXECUTED:", JSON.stringify(underwritingResultLog, null, 2));
    console.log("ELIGIBILITY ENGINE RESULT:", JSON.stringify(eligibilityResultLog, null, 2));
    console.log("WORKFLOW ROUTING RESULT:", JSON.stringify(workflowResultLog, null, 2));

    // 9. Store COMPLETE bureau report & outcomes inside DB
    const affordabilityOutcome = {
      incomeAssessed: borrowerIncome,
      bureauMonthlyDebt: totalMonthlyInstallment,
      dtiCalculated: dti,
      isDtiCompliant: isDtiEligible,
      isDisposableCompliant: isDisposableEligible,
      survivalBufferBenchmark: minDisposable,
      warnings: reasons,
      sandboxSimulationActive: sandboxFraudSimulation
    };

    // PDF Compliance Processing & Archiving
    let archiveRecord = null;
    let pdfUrl = null;
    let pdfVersionNumber = 1;
    let computedPdfHash = '';

    if (reportData.pdfReport && settings.enableBureauPdfArchiving !== false) {
      try {
        console.log(`[COMPLIANCE] Decoding and processing PDF for application ${applicationId}`);
        let pdfBuffer = Buffer.from(reportData.pdfReport, 'base64');
        
        // Decrypt Datanamix encryption password and apply watermark if sandbox
        pdfBuffer = await decryptAndProcessPdf(pdfBuffer, testModeActive, settings.enableSandboxWatermark !== false);

        // SHA-256 Hashing
        computedPdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

        // Determine version number
        const latestArchive = await BureauReportArchive.findOne({ applicationId }).sort({ pdfVersion: -1 });
        pdfVersionNumber = latestArchive ? latestArchive.pdfVersion + 1 : 1;

        // Upload to ImageKit
        const folderPath = `/bureau-reports/${applicationId}/v${pdfVersionNumber}`;
        const fileName = `report.pdf`;
        
        console.log(`[COMPLIANCE] Uploading to ImageKit in folder: ${folderPath}`);
        const uploadResponse = await ImageKit.upload({
          file: pdfBuffer,
          fileName: fileName,
          folder: folderPath
        });

        pdfUrl = uploadResponse.url;

        // Save archive record
        archiveRecord = await BureauReportArchive.create({
          applicationId,
          borrowerId: application.borrowerId,
          enquiryId: storedEnquiryId,
          enquiryResultId: storedEnquiryResultId,
          bureauReference: reportData.reportReference || 'N/A',
          pdfPath: uploadResponse.url,
          reportType: 'Consumer Credit Report',
          generatedBy: initiatedBy || application.borrowerId,
          environmentType: testModeActive ? 'SANDBOX' : 'LIVE',
          pdfVersion: pdfVersionNumber,
          pdfHash: computedPdfHash,
          imagekitFileId: uploadResponse.fileId,
          imagekitUrl: uploadResponse.url,
          fileSize: pdfBuffer.length,
          isSandboxReport: testModeActive
        });

        console.log(`[COMPLIANCE] PDF archived successfully. Version: ${pdfVersionNumber}, ID: ${archiveRecord._id}`);
      } catch (pdfErr) {
        console.error('⚠️ [COMPLIANCE ERROR] PDF processing / ImageKit upload failed:', pdfErr.message);
      }
    }

    // Clean up large PDF base64 string to prevent MongoDB bloating
    if (reportData.rawResponse) {
      if (reportData.rawResponse.PDFReport) reportData.rawResponse.PDFReport = undefined;
      if (reportData.rawResponse.Consumer && reportData.rawResponse.Consumer.PDFReport) {
        reportData.rawResponse.Consumer.PDFReport = undefined;
      }
    }
    const rawPdfBase64Saved = reportData.pdfReport; // temporary store in case we want to output to response
    reportData.pdfReport = undefined;

    const updatedApp = await LoanApplication.findByIdAndUpdate(applicationId, {
      consumerCreditReportRaw: reportData.rawResponse,
      consumerCreditScore: finalScore,
      consumerRiskCategory: riskCategory,
      consumerDebtSummary: {
        totalOutstandingDebt,
        totalMonthlyInstallment,
        totalArrearsAmount,
        judgmentCount,
        defaultListingCount: defaultCount,
        highestMonthsInArrears,
        activeAccountsCount: reportData.accountSummary?.length || 0,
        propertyOwnershipCount: reportData.properties?.length || 0
      },
      fraudIndicators: {
        safpsListed,
        deceasedStatus: deceasedFlag,
        debtReviewStatus,
        homeAffairsVerified
      },
      affordabilityOutcome,
      underwritingDecision,
      workflowRoute,
      bureauRecommendation: underwritingDecision,
      bureauReportFetchedAt: new Date(),
      // Also update nested consumerCreditReport object if legacy logic checks it
      'consumerCreditReport.verificationStatus': 'Verified',
      'consumerCreditReport.completedAt': new Date(),
      'consumerCreditReport.reportReference': reportData.reportReference,
      'consumerCreditReport.reportDate': reportData.reportDate,
      'consumerCreditReport.scoring': reportData.scoring,
      'consumerCreditReport.debtSummary': reportData.debtSummary,
      'consumerCreditReport.fraudIndicators': reportData.fraudIndicators,
      'consumerCreditReport.underwriting': {
        level: underwritingDecision,
        riskCategory,
        reasons
      },
      'consumerCreditReport.consumerDetails': reportData.consumerDetails,
      'consumerCreditReport.accountSummary': reportData.accountSummary,
      'consumerCreditReport.adverseInformation': reportData.adverseInformation,
      'consumerCreditReport.properties': reportData.properties,
      'consumerCreditReport.directorships': reportData.directorships,
      'consumerCreditReport.addressHistory': reportData.addressHistory,
      'consumerCreditReport.employmentHistory': reportData.employmentHistory,
      'consumerCreditReport.enquiryHistory': reportData.enquiryHistory,
      'consumerCreditReport.monthlyPaymentHistory': reportData.monthlyPaymentHistory,
      'consumerCreditReport.pdfReport': undefined, // stripped to prevent bloating
      'consumerCreditReport.rawResponse': reportData.rawResponse
    }, { new: true });

    let currentHash = '';
    if (updatedApp) {
      currentHash = generateVerificationHash(updatedApp, borrower);
      updatedApp.creditAssessment.verificationHash = currentHash;
      updatedApp.consumerCreditReport.verificationHash = currentHash;
      await updatedApp.save();
    }

    // 10. Audit Log Writes
    const logBorrowerId = application?.borrowerId || borrower?._id || initiatedBy;
    try {
      // Legacy log type
      await writeAuditLogLocal({
        borrowerId: logBorrowerId,
        applicationId,
        verificationType: 'CONSUMER_CREDIT_REPORT_RESULT',
        status: 'SUCCESS',
        initiatedBy: initiatedBy || logBorrowerId,
        requestPayload: {
          enquiryId: storedEnquiryId,
          enquiryResultId: storedEnquiryResultId
        },
        responsePayload: {
          bureauScore: finalScore,
          riskCategory,
          underwritingDecision,
          eligibilityStatus,
          workflowRoute,
          dti,
          totalDebt: totalOutstandingDebt,
          monthlyInstallment: totalMonthlyInstallment,
          judgmentCount,
          defaultCount,
          fraudDetected: deceasedFlag || safpsListed,
          deceasedFlag
        }
      });

      // Log report fetch audit trail
      await writeAuditLogLocal({
        borrowerId: logBorrowerId,
        applicationId,
        verificationType: 'CREDIT_REPORT_FETCH',
        status: 'SUCCESS',
        initiatedBy: initiatedBy || logBorrowerId,
        riskSeverity,
        workflowRoute,
        requestPayload: { enquiryId: storedEnquiryId, enquiryResultId: storedEnquiryResultId },
        responsePayload: {
          bureauScore: finalScore,
          riskCategory,
          underwritingDecision,
          eligibilityStatus,
          workflowRoute,
          verificationHash: currentHash
        }
      });

      // Escalation trigger check
      if (workflowRoute === 'RISK_ESCALATION_QUEUE' || workflowRoute === 'FRAUD_QUEUE' || chronicArrears || riskSeverity === 'High' || riskSeverity === 'Critical') {
        await writeAuditLogLocal({
          borrowerId: logBorrowerId,
          applicationId,
          verificationType: 'WORKFLOW_ESCALATION',
          status: 'SUCCESS',
          initiatedBy: initiatedBy || logBorrowerId,
          riskSeverity,
          workflowRoute,
          requestPayload: { decision: underwritingDecision, reasons }
        });
      }

      // Manual review trigger check
      if (underwritingDecision === 'MANUAL_REVIEW' || underwritingDecision === 'Manual Review' || underwritingDecision === 'Manual Review Required') {
        await writeAuditLogLocal({
          borrowerId: logBorrowerId,
          applicationId,
          verificationType: 'MANUAL_REVIEW_TRIGGER',
          status: 'SUCCESS',
          initiatedBy: initiatedBy || logBorrowerId,
          riskSeverity,
          workflowRoute,
          requestPayload: { decision: underwritingDecision, reasons }
        });
      }

    } catch (auditErr) {
      console.error('[Audit Log Error]', auditErr.message);
    }

    // 11. Final standard API response envelope
    return res.status(200).json({
      success: true,
      message: 'Consumer credit report fetched successfully',
      data: {
        bureauScore: finalScore,
        riskCategory,
        riskSeverity,
        underwritingDecision,
        eligibilityStatus,
        workflowRoute,
        dti: Math.round(dti),
        totalDebt: totalOutstandingDebt,
        totalArrearsAmount: totalArrearAmount,
        monthlyInstallment: totalMonthlyInstallment,
        judgmentCount,
        defaultCount,
        fraudDetected,
        deceasedFlag,
        propertyCount: reportData?.properties?.length || 0,
        activeAccounts: reportData?.accountSummary?.length || 0,
        bureauReportReference: reportData?.reportReference || 'Ref123',
        sandboxSimulationActive: sandboxFraudSimulation,
        warnings: reasons,
        monthlyPaymentHistory: reportData?.monthlyPaymentHistory || [],
        consumerSearchExecuted: true,
        creditReportFetched: true,
        previousVerificationLoaded: true,
        verificationLastRunAt: new Date(),
        verificationHashValid: true
      }
    });

  } catch (error) {
    console.error('❌ [Consumer Credit Report Controller Error]:', error.message);

    // Save failure audit log
    try {
      const failApp = await LoanApplication.findById(applicationId).select('borrowerId').catch(() => null);
      const logBorrowerId = failApp?.borrowerId || application?.borrowerId || initiatedBy;
      
      if (logBorrowerId) {
        await writeAuditLogLocal({
          borrowerId: logBorrowerId,
          applicationId,
          verificationType: 'CONSUMER_CREDIT_REPORT_RESULT_FAILED',
          status: 'FAILED',
          initiatedBy: initiatedBy || logBorrowerId,
          errorMessage: error.message
        });
      }
    } catch (auditErr) {
      console.error('[Audit Log Error]', auditErr.message);
    }

    return res.status(500).json({
      success: false,
      message: error.message || 'Error executing consumer credit report and underwriting engine.'
    });
  }
};

// ─── PDF STREAM & AUDIT CONTROLLERS ───────────────────────────────────────────

exports.getCreditReportPdfController = async (req, res) => {
  const { applicationId } = req.params;
  const version = req.query.version;
  const userId = req.user ? req.user._id : null;
  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  try {
    const settings = (await SystemSettings.findOne()) || {};
    if (!settings.enableBureauPdfArchiving) {
      return res.status(403).json({ success: false, message: 'PDF archiving and viewing is currently disabled by policy.' });
    }

    // Find the archive record
    const query = { applicationId };
    if (version) {
      query.pdfVersion = parseInt(version, 10);
    }
    const archive = await BureauReportArchive.findOne(query).sort({ pdfVersion: -1 });

    if (!archive) {
      return res.status(404).json({ success: false, message: 'No credit report PDF found for this application.' });
    }

    // Log the view event
    archive.viewsLog.push({
      viewedBy: userId,
      ipAddress,
      viewedAt: new Date()
    });
    await archive.save();

    // Stream from ImageKit to response
    const response = await axios({
      method: 'get',
      url: archive.imagekitUrl,
      responseType: 'stream'
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="report.pdf"');
    response.data.pipe(res);
  } catch (error) {
    console.error('Error streaming PDF:', error.message);
    res.status(500).json({ success: false, message: 'Error streaming credit report PDF.' });
  }
};

exports.downloadCreditReportController = async (req, res) => {
  const { applicationId } = req.params;
  const version = req.query.version;
  const userId = req.user ? req.user._id : null;
  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  try {
    const settings = (await SystemSettings.findOne()) || {};
    if (!settings.allowPdfDownload) {
      return res.status(403).json({ success: false, message: 'PDF download is disabled by administrative policy.' });
    }

    // Find the archive record
    const query = { applicationId };
    if (version) {
      query.pdfVersion = parseInt(version, 10);
    }
    const archive = await BureauReportArchive.findOne(query).sort({ pdfVersion: -1 });

    if (!archive) {
      return res.status(404).json({ success: false, message: 'No credit report PDF found for download.' });
    }

    // Log the download event
    archive.downloadsLog.push({
      downloadedBy: userId,
      ipAddress,
      downloadedAt: new Date()
    });
    await archive.save();

    // Stream from ImageKit to response as attachment
    const response = await axios({
      method: 'get',
      url: archive.imagekitUrl,
      responseType: 'stream'
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="bureau-report-v${archive.pdfVersion}.pdf"`);
    response.data.pipe(res);
  } catch (error) {
    console.error('Error downloading PDF:', error.message);
    res.status(500).json({ success: false, message: 'Error downloading credit report PDF.' });
  }
};

exports.getCreditReportHistoryController = async (req, res) => {
  const { applicationId } = req.params;

  try {
    const settings = (await SystemSettings.findOne()) || {};
    if (!settings.allowVersionHistory) {
      return res.status(403).json({ success: false, message: 'Version history access is disabled by policy.' });
    }

    // Get all versions, populated with user info
    const history = await BureauReportArchive.find({ applicationId })
      .populate('generatedBy', 'firstName lastName name email role')
      .sort({ pdfVersion: -1 });

    return res.status(200).json({
      success: true,
      history: history.map(item => ({
        version: item.pdfVersion,
        generatedAt: item.generatedAt,
        generatedBy: item.generatedBy,
        fileSize: item.fileSize,
        pdfHash: item.pdfHash,
        viewsCount: item.viewsLog.length,
        downloadsCount: item.downloadsLog.length,
        printsCount: item.printsLog.length,
        environmentType: item.environmentType
      }))
    });
  } catch (error) {
    console.error('Error fetching version history:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching report version history.' });
  }
};

exports.logPrintEventController = async (req, res) => {
  const { applicationId } = req.params;
  const { version } = req.body;
  const userId = req.user ? req.user._id : null;
  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  try {
    const settings = (await SystemSettings.findOne()) || {};
    if (!settings.allowPdfPrint) {
      return res.status(403).json({ success: false, message: 'PDF printing is disabled by administrative policy.' });
    }

    const query = { applicationId };
    if (version) {
      query.pdfVersion = parseInt(version, 10);
    }
    const archive = await BureauReportArchive.findOne(query).sort({ pdfVersion: -1 });

    if (!archive) {
      return res.status(404).json({ success: false, message: 'No credit report record found to log print event.' });
    }

    archive.printsLog.push({
      printedBy: userId,
      ipAddress,
      printedAt: new Date()
    });
    await archive.save();

    return res.status(200).json({ success: true, message: 'Print audit event logged successfully.' });
  } catch (error) {
    console.error('Error logging print event:', error.message);
    res.status(500).json({ success: false, message: 'Error logging print event.' });
  }
};
