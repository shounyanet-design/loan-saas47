/**
 * Verification Integration Controller
 * Orchestrates calls to the Datanamix module and commits audit histories to MongoDB.
 */

const datanamix = require('../integrations/datanamix');
const { generateVerificationHash } = require('../utils/verificationHashEngine');
const VerificationLog = require('../models/VerificationLog');
const CreditReport = require('../models/CreditReport');
const AMLCheck = require('../models/AMLCheck');
const tokenService = require('../modules/commerce/services/tokenService');
const BankVerification = require('../models/BankVerification');
const Borrower = require('../models/Borrower');
const LoanApplication = require('../models/LoanApplication');
const SystemSettings = require('../models/SystemSettings');
const { callProfileIdPhotoMatch } = require('../services/datanamix/profileIdPhotoVerification.service');
const { callAddressPlusProfileIdv } = require('../services/datanamix/addressProfileIdv.service');
const { callConsumerCreditSearch } = require('../services/datanamix/consumerCreditSearch.service');
const { callConsumerCreditResult }  = require('../services/datanamix/consumerCreditResult.service');
const { callPhoneVerification }     = require('../services/datanamix/phoneVerification.service');
const { callBankVerification }      = require('../services/datanamix/bankVerification.service');
const { callAMLVerification }       = require('../services/datanamix/amlVerification.service');
const { getIO } = require('../socket/socketServer');
const tenantContext = require('../tenancy/tenantContext');
const { isDevelopmentSandboxBypassEnabled, isDevelopmentNextStepBypassEnabled } = require('../utils/devSandboxBypass');

const validateSAPhone = (phone) => {
  if (!phone) return false;
  return /^0\d{9}$/.test(phone.trim());
};

const validateFullName = (name) => {
  if (!name) return false;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const words = trimmed.split(' ').filter(Boolean);
  if (words.length < 2) return false;
  return /^[a-zA-Z\s]+$/.test(trimmed);
};

const formatFullName = (name) => {
  if (!name) return '';
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Helper to log verification transactions to MongoDB VerificationLog collection
 */
const writeAuditLog = async (data) => {
  try {
    return await VerificationLog.create(data);
  } catch (err) {
    console.error('⚠️ [Audit Log Error]: Failed to write log to database:', err.message);
  }
};

/**
 * 1. Borrower ID Verification Controller (DHA Profile IDV Plus Photo)
 */
exports.verifyIdentityController = async (req, res) => {
  const { borrowerId, idNumber, fullName, dateOfBirth, selfiePhotoBase64, applicationId } = req.body;
  const initiatedBy = req.user ? req.user._id : null;

  try {
    console.log(`👤 [Identity Verification Route Handled] - ID: ${idNumber}`);

    if (!validateFullName(fullName)) {
      return res.status(400).json({
        success: false,
        message: 'Enter borrower full legal name.'
      });
    }

    const formattedName = formatFullName(fullName);

    // Charge tokens for IDV Plus Photo
    const tenantId = req.tenantId || req.user?.tenantId;
    const idemKey = `idem-idv-${borrowerId || idNumber}-${applicationId || ''}`;
    await tokenService.charge(tenantId, 'phone_verification', {
      actor: initiatedBy,
      idempotencyKey: idemKey,
      metadata: { borrowerId, applicationId, idNumber }
    });

    // Call integration module
    const result = await datanamix.identity.verifyIdentity({
      idNumber,
      fullName: formattedName,
      dateOfBirth,
      selfiePhotoBase64
    });

    // Write audit log
    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'IDV_PHOTO',
      status: 'SUCCESS',
      initiatedBy,
      requestPayload: { idNumber, fullName: formattedName, dateOfBirth },
      responsePayload: result
    });

    return res.status(200).json({
      success: true,
      message: 'ID Verification initialized successfully in pre-integration phase.',
      data: result
    });
  } catch (error) {
    console.error('❌ [Identity Controller Error]:', error.message);
    
    // Log failure
    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'IDV_PHOTO',
      status: 'FAILED',
      initiatedBy,
      requestPayload: { idNumber, fullName: req.body.fullName ? formatFullName(req.body.fullName) : '', dateOfBirth },
      errorMessage: error.message
    });

    return res.status(error.status || error.statusCode || 500).json({
      success: false,
      message: error.message || 'Error occurred during ID verification.'
    });
  }
};

/**
 * 2. Face Liveness Verification Controller (FaceTec Liveness 3D)
 */
exports.verifyFaceLivenessController = async (req, res) => {
  const { borrowerId, faceScan, auditTrailImage, sessionId, applicationId } = req.body;
  const initiatedBy = req.user ? req.user._id : null;

  try {
    console.log(`🎭 [Face Liveness Route Handled] - Session: ${sessionId}`);

    const tenantId = req.tenantId || req.user?.tenantId;
    const idemKey = `idem-liveness-${sessionId || borrowerId}-${applicationId || ''}`;
    await tokenService.charge(tenantId, 'facetec', {
      actor: initiatedBy,
      idempotencyKey: idemKey,
      metadata: { borrowerId, applicationId, sessionId }
    });

    const result = await datanamix.identity.verifyFaceLiveness({
      faceScan,
      auditTrailImage,
      sessionId
    });

    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'FACETEC_LIVENESS',
      status: 'SUCCESS',
      initiatedBy,
      requestPayload: { sessionId },
      responsePayload: result
    });

    return res.status(200).json({
      success: true,
      message: 'Face Tec Liveness validation initialized successfully.',
      data: result
    });
  } catch (error) {
    console.error('❌ [Face Liveness Controller Error]:', error.message);

    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'FACETEC_LIVENESS',
      status: 'FAILED',
      initiatedBy,
      requestPayload: { sessionId },
      errorMessage: error.message
    });

    return res.status(error.status || error.statusCode || 500).json({
      success: false,
      message: error.message || 'Error occurred during face liveness verification.'
    });
  }
};

/**
 * 2.5. FaceTec Session Token Controller
 */
exports.getFaceSessionTokenController = async (req, res) => {
  try {
    console.log(`🎭 [FaceTec Session Token Requested]`);
    const result = await datanamix.identity.getFaceSessionToken();
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('❌ [FaceTec Session Token Controller Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error occurred while retrieving FaceTec session token.'
    });
  }
};

/**
 * 3. Bank Account Ownership Verification Controller (Account Holder Verification Advanced)
 */
exports.verifyBankController = async (req, res) => {
  const { borrowerId, bankName, accountNumber, branchCode, idNumber, accountHolderName, accountType, applicationId } = req.body;
  const initiatedBy = req.user ? req.user._id : null;

  try {
    console.log(`[][] [Bank AHV Route Handled] - Acc: ${accountNumber}`);

    const tenantId = req.tenantId || req.user?.tenantId;
    const idemKey = `idem-bank-${accountNumber}-${applicationId || ''}`;
    await tokenService.charge(tenantId, 'phone_verification', {
      actor: initiatedBy,
      idempotencyKey: idemKey,
      metadata: { borrowerId, applicationId, accountNumber }
    });

    const result = await datanamix.bank.verifyBankAccount({
      bankName,
      accountNumber,
      branchCode,
      idNumber,
      accountHolderName,
      accountType
    });

    // Persistent storage model creation
    await BankVerification.create({
      borrowerId,
      applicationId,
      bankName,
      accountNumber,
      branchCode,
      matchIndicators: result.matchIndicators,
      rawVerificationResult: result,
      verificationSuccess: false
    });

    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'BANK_AHV',
      status: 'SUCCESS',
      initiatedBy,
      requestPayload: { bankName, accountNumber, branchCode, idNumber, accountHolderName },
      responsePayload: result
    });

    return res.status(200).json({
      success: true,
      message: 'Bank verification records generated in pre-integration phase.',
      data: result
    });
  } catch (error) {
    console.error('❌ [Bank Verification Controller Error]:', error.message);

    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'BANK_AHV',
      status: 'FAILED',
      initiatedBy,
      requestPayload: { bankName, accountNumber, branchCode, idNumber, accountHolderName },
      errorMessage: error.message
    });

    return res.status(error.status || error.statusCode || 500).json({
      success: false,
      message: error.message || 'Error occurred during bank account verification.'
    });
  }
};

/**
 * 4. Credit Bureau Checks Controller (Consumer Credit Report)
 */
exports.verifyCreditController = async (req, res) => {
  const { borrowerId, idNumber, fullName, consentAccepted, applicationId } = req.body;
  const initiatedBy = req.user ? req.user._id : null;

  try {
    console.log(`📊 [Credit Bureau Check Route Handled] - ID: ${idNumber}`);

    const tenantId = req.tenantId || req.user?.tenantId;
    const idemKey = `idem-credit-${idNumber}-${applicationId || ''}`;
    await tokenService.charge(tenantId, 'credit_bureau', {
      actor: initiatedBy,
      idempotencyKey: idemKey,
      metadata: { borrowerId, applicationId, idNumber }
    });

    const result = await datanamix.credit.getConsumerCreditReport({
      idNumber,
      fullName,
      consentAccepted
    });

    // Persistent storage model creation
    await CreditReport.create({
      borrowerId,
      applicationId,
      creditScore: 0, // Placeholder during blueprint phase
      scoreBand: 'UNKNOWN',
      riskCategory: 'N/A',
      consentAccepted,
      bureauRawData: result
    });

    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'CREDIT_REPORT',
      status: 'SUCCESS',
      initiatedBy,
      requestPayload: { idNumber, fullName, consentAccepted },
      responsePayload: result
    });

    return res.status(200).json({
      success: true,
      message: 'Credit Bureau lookup pre-flight verification completed.',
      data: result
    });
  } catch (error) {
    console.error('❌ [Credit Controller Error]:', error.message);

    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'CREDIT_REPORT',
      status: 'FAILED',
      initiatedBy,
      requestPayload: { idNumber, fullName, consentAccepted },
      errorMessage: error.message
    });

    return res.status(error.status || error.statusCode || 500).json({
      success: false,
      message: error.message || 'Error occurred during credit bureau report pulling.'
    });
  }
};

/**
 * 5. Phone Verification Controller (Carrier Identity)
 */
exports.verifyPhoneController = async (req, res) => {
  const { borrowerId, phoneNumber, idNumber, fullName, applicationId } = req.body;
  const initiatedBy = req.user ? req.user._id : null;

  try {
    console.log(`📱 [Phone Verification Route Handled] - Phone: ${phoneNumber}`);

    if (!validateSAPhone(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Enter a valid South African phone number.'
      });
    }

    if (!validateFullName(fullName)) {
      return res.status(400).json({
        success: false,
        message: 'Enter borrower full legal name.'
      });
    }

    const formattedName = formatFullName(fullName);

    const tenantId = req.tenantId || req.user?.tenantId;
    const idemKey = `idem-phone-${phoneNumber}-${applicationId || ''}`;
    await tokenService.charge(tenantId, 'phone_verification', {
      actor: initiatedBy,
      idempotencyKey: idemKey,
      metadata: { borrowerId, applicationId, phoneNumber }
    });

    const result = await datanamix.phone.verifyPhoneOwnership({
      phoneNumber,
      idNumber,
      fullName: formattedName
    });

    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'PHONE_CARRIER',
      status: 'SUCCESS',
      initiatedBy,
      requestPayload: { phoneNumber, idNumber, fullName: formattedName },
      responsePayload: result
    });

    return res.status(200).json({
      success: true,
      message: 'Carrier identity matching process prepared.',
      data: result
    });
  } catch (error) {
    console.error('❌ [Phone Controller Error]:', error.message);

    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'PHONE_CARRIER',
      status: 'FAILED',
      initiatedBy,
      requestPayload: { 
        phoneNumber, 
        idNumber, 
        fullName: req.body.fullName ? formatFullName(req.body.fullName) : '' 
      },
      errorMessage: error.message
    });

    return res.status(error.status || error.statusCode || 500).json({
      success: false,
      message: error.message || 'Error occurred during phone carrier verification.'
    });
  }
};

/**
 * 6. AML & Sanctions Screening Controller (AML Sanctions + PEP + Crime Data)
 */
exports.verifyAMLController = async (req, res) => {
  const { borrowerId, idNumber, fullName, dateOfBirth, applicationId } = req.body;
  const initiatedBy = req.user ? req.user._id : null;

  try {
    console.log(`🛡️ [AML pep Screening Route Handled] - Name: ${fullName}`);

    const tenantId = req.tenantId || req.user?.tenantId;
    const idemKey = `idem-aml-${idNumber || fullName}-${applicationId || ''}`;
    await tokenService.charge(tenantId, 'aml', {
      actor: initiatedBy,
      idempotencyKey: idemKey,
      metadata: { borrowerId, applicationId, idNumber }
    });

    const result = await datanamix.aml.screenAML({
      idNumber,
      fullName,
      dateOfBirth
    });

    // Persistent storage model creation
    await AMLCheck.create({
      borrowerId,
      pepStatusDetected: false,
      sanctionStatusDetected: false,
      crimeRecordDetected: false,
      riskScore: 0,
      screeningRawResponse: result,
      complianceOutcome: 'PASSED'
    });

    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'AML_PEP',
      status: 'SUCCESS',
      initiatedBy,
      requestPayload: { idNumber, fullName, dateOfBirth },
      responsePayload: result
    });

    return res.status(200).json({
      success: true,
      message: 'AML watchlists verification logged.',
      data: result
    });
  } catch (error) {
    console.error('❌ [AML pep Screening Controller Error]:', error.message);

    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'AML_PEP',
      status: 'FAILED',
      initiatedBy,
      requestPayload: { idNumber, fullName, dateOfBirth },
      errorMessage: error.message
    });

    return res.status(error.status || error.statusCode || 500).json({
      success: false,
      message: error.message || 'Error occurred during AML sanctions screening.'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. KYC Profile Plus ID Photo Match Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/verification/profile-id-photo-match
 * Multipart: idFrontImage (required), selfieImage (optional), idBackImage (optional)
 * Body fields: idNumber (required), applicationId (optional), borrowerId (optional)
 */
exports.verifyBorrowerKYCController = async (req, res) => {
  const initiatedBy = req.user?._id;
  const { idNumber, applicationId, borrowerId: bodyBorrowerId } = req.body;

  // borrowerId: use body value or fall back to the authenticated user's _id
  const borrowerId = bodyBorrowerId || initiatedBy;
  const tenantId = req.tenantId || req.user?.tenantId;

  return tenantContext.runWithTenant(tenantId, async () => {
    if (!idNumber) {
      return res.status(400).json({ success: false, message: 'idNumber is required' });
    }

    const idFrontFile = req.files?.idFrontImage?.[0] || req.file;
    if (!idFrontFile) {
      return res.status(400).json({ success: false, message: 'idFrontImage is required' });
    }

    try {
      console.log(`[KYC Controller] Starting verification — ID: ${idNumber}`);

      const idemKey = `idem-kyc-ocr-${idNumber}-${applicationId || ''}`;
      await tokenService.charge(tenantId, 'ocr', {
        actor: initiatedBy,
        idempotencyKey: idemKey,
        metadata: { borrowerId, applicationId, idNumber }
      });

      const result = await callProfileIdPhotoMatch({
        idNumber,
        captureImageBuffer: idFrontFile.buffer,
        clientReference: applicationId || `TEMP-${Date.now()}`,
      });

      // ── Audit log ──────────────────────────────────────────────────────────
      await writeAuditLog({
        borrowerId,
        applicationId: applicationId || undefined,
        verificationType: 'KYC_PROFILE_PHOTO',
        status: result.verificationStatus === 'Verified' ? 'SUCCESS' : 'FAILED',
        initiatedBy,
        requestPayload: { idNumber, clientReference: applicationId },
        responsePayload: {
          responseStatusCode: result.responseStatusCode,
          verificationStatus: result.verificationStatus,
          faceMatchScore: result.faceMatchScore,
          verificationReference: result.verificationReference,
        },
      });

      // ── Persist into LoanApplication if applicationId provided ─────────────
      if (applicationId) {
        await LoanApplication.findByIdAndUpdate(applicationId, {
          'kycVerification.verificationStatus': result.verificationStatus,
          'kycVerification.responseStatusCode': result.responseStatusCode,
          'kycVerification.responseMessage': result.responseMessage,
          'kycVerification.faceMatchScore': result.faceMatchScore,
          'kycVerification.verificationReference': result.verificationReference,
          'kycVerification.verificationTimestamp': new Date(),
          'kycVerification.fraudFlags': result.fraudFlags,
          'kycVerification.extractedOCRData': result.extractedOCRData,
          'kycVerification.verificationPdf': result.verificationPdf,
          'kycVerification.rawApiResponse': result.rawApiResponse,
          'kycVerification.verifiedBy': initiatedBy,
          'kycVerification.verificationSource': 'DATANAMIX',
          'kycVerification.verificationProvider': 'Profile Plus ID Photo Match',
        });
      }

      // ── Socket events ──────────────────────────────────────────────────────
      try {
        const io = getIO();
        const roomId = borrowerId?.toString();
        if (result.verificationStatus === 'Verified') {
          io.to(roomId).emit('verification-completed', {
            applicationId,
            faceMatchScore: result.faceMatchScore,
            message: 'Identity verified successfully',
          });
        } else {
          io.to(roomId).emit('verification-failed', {
            applicationId,
            responseMessage: result.responseMessage,
            message: 'Identity verification failed',
          });

          if (result.fraudFlags?.length) {
            io.to(roomId).emit('fraud-flagged', {
              applicationId,
              fraudFlags: result.fraudFlags,
            });
          }
        }
      } catch {
        // Socket not initialized — non-fatal
      }

      return res.status(200).json({
        success: true,
        message: result.verificationStatus === 'Verified'
          ? 'Identity verified successfully'
          : 'Identity verification failed',
        data: {
          verificationStatus: result.verificationStatus,
          responseStatusCode: result.responseStatusCode,
          responseMessage: result.responseMessage,
          faceMatchScore: result.faceMatchScore,
          verificationReference: result.verificationReference,
          verificationTimestamp: new Date(),
          fraudFlags: result.fraudFlags,
          extractedOCRData: result.extractedOCRData,
        },
      });
    } catch (error) {
      console.error('[KYC Controller Error]:', error.message);

      await writeAuditLog({
        borrowerId,
        applicationId: applicationId || undefined,
        verificationType: 'KYC_PROFILE_PHOTO',
        status: 'ERROR',
        initiatedBy,
        requestPayload: { idNumber },
        errorMessage: error.message,
      });

      return res.status(error.status || error.response?.status || 500).json({
        success: false,
        message: error.response?.data?.message || error.message || 'KYC verification failed',
      });
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. Admin KYC Override
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PUT /api/verification/kyc-override/:applicationId
 * Admin only — manually override a failed KYC verification with mandatory reason
 */
exports.overrideKYCController = async (req, res) => {
  const { applicationId } = req.params;
  const { overrideReason } = req.body;
  const adminId = req.user?._id;

  if (!overrideReason?.trim()) {
    return res.status(400).json({ success: false, message: 'overrideReason is required for KYC override' });
  }

  try {
    const settings = await SystemSettings.findOne();
    if (settings && settings.manualOverrideAllowed === false) {
      return res.status(403).json({ success: false, message: 'Manual override is not allowed under current system settings.' });
    }

    const application = await LoanApplication.findById(applicationId);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    await LoanApplication.findByIdAndUpdate(applicationId, {
      'kycVerification.verificationStatus': 'Overridden',
      'kycVerification.overrideReason': overrideReason.trim(),
      'kycVerification.overrideBy': adminId,
      'kycVerification.overrideAt': new Date(),
    });

    // Audit log for override
    await writeAuditLog({
      borrowerId: application.borrowerId || adminId,
      applicationId,
      verificationType: 'KYC_OVERRIDE',
      status: 'SUCCESS',
      initiatedBy: adminId,
      requestPayload: { overrideReason, applicationId },
      responsePayload: { action: 'KYC_MANUAL_OVERRIDE', overrideBy: adminId },
    });

    // Socket — notify borrower room
    try {
      const io = getIO();
      io.to(application.borrowerId?.toString()).emit('verification-completed', {
        applicationId,
        message: 'KYC verification manually overridden by admin',
        overridden: true,
      });
    } catch {
      // Socket not initialized — non-fatal
    }

    return res.status(200).json({
      success: true,
      message: 'KYC verification successfully overridden',
      data: { applicationId, overrideReason, overrideAt: new Date() },
    });
  } catch (error) {
    console.error('[KYC Override Error]:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Override failed' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. Address Plus Profile IDV (Bureau Verification — Step 1.5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/verification/address-plus-profile-idv
 *
 * Requires biometric KYC (Step 1) to be Verified or Overridden first.
 * Body: { applicationId, idNumber, surname, passportNumber?,
 *          phoneNumber?, emailAddress?, residentialAddress?, employerName? }
 */
exports.verifyAddressProfileController = async (req, res) => {
  const initiatedBy = req.user?._id;
  const {
    applicationId,
    idNumber,
    surname,
    passportNumber,
    phoneNumber,
    emailAddress,
    residentialAddress,
    employerName,
    borrowerId: bodyBorrowerId,
  } = req.body;

  const borrowerId = bodyBorrowerId || initiatedBy;

  if (!idNumber) return res.status(400).json({ success: false, message: 'idNumber is required' });
  if (!surname)  return res.status(400).json({ success: false, message: 'surname is required' });

  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    const idemKey = `idem-address-profile-${idNumber}-${applicationId || ''}`;
    await tokenService.charge(tenantId, 'credit_bureau', {
      actor: initiatedBy,
      idempotencyKey: idemKey,
      metadata: { borrowerId, applicationId, idNumber }
    });

    // ── Guard: biometric must be completed first ───────────────────────────
    if (applicationId) {
      const app = await LoanApplication.findById(applicationId).select('kycVerification');
      if (app) {
        const kycStatus = app.kycVerification?.verificationStatus;
        if (!kycStatus || kycStatus === 'Pending' || kycStatus === 'Failed') {
          if (isDevelopmentSandboxBypassEnabled()) {
            console.warn('[DEV SANDBOX BYPASS] Bureau gate bypassed — KYC not verified.');
          } else {
            return res.status(400).json({
              success: false,
              message: 'Biometric identity verification must be completed before bureau verification.',
            });
          }
        }
      }
    }

    console.log(`[BUREAU Controller] Starting bureau verification — ID: ${idNumber}`);

    const result = await callAddressPlusProfileIdv({
      surname,
      idNumber,
      passportNumber: passportNumber || '',
      clientReference: applicationId || `BUREAU-${Date.now()}`,
      borrowerData: { fullName: `${surname}`, phoneNumber, emailAddress, residentialAddress, employerName },
    });

    // ── Determine block-level ──────────────────────────────────────────────
    // Fatal: deceased or SAFPS listing blocks progression
    const isFatal = result.deceasedStatus || result.safpsFlag;
    const hasWarnings = result.mismatchFlags?.length > 0;

    // ── Persist to LoanApplication ─────────────────────────────────────────
    if (applicationId) {
      await LoanApplication.findByIdAndUpdate(applicationId, {
        'bureauVerification.verificationStatus': result.verificationStatus,
        'bureauVerification.responseCode':    result.responseCode,
        'bureauVerification.responseMessage': result.responseMessage,
        'bureauVerification.bureauReference': result.bureauReference,
        'bureauVerification.verifiedFirstName':          result.verifiedFirstName,
        'bureauVerification.verifiedSurname':            result.verifiedSurname,
        'bureauVerification.verifiedPhone':              result.verifiedPhone,
        'bureauVerification.verifiedEmail':              result.verifiedEmail,
        'bureauVerification.verifiedEmployer':           result.verifiedEmployer,
        'bureauVerification.verifiedResidentialAddress': result.verifiedResidentialAddress,
        'bureauVerification.verifiedPostalAddress':      result.verifiedPostalAddress,
        'bureauVerification.deceasedStatus': result.deceasedStatus,
        'bureauVerification.deceasedDate':   result.deceasedDate,
        'bureauVerification.safpsFlag':      result.safpsFlag,
        'bureauVerification.fraudIndicators': result.fraudFlags,
        'bureauVerification.addressHistory': result.addressHistory,
        'bureauVerification.pdfReport':      result.pdfReport,
        'bureauVerification.bureauRawResponse': result.bureauRawResponse,
        'bureauVerification.verifiedAt':     new Date(),
        'bureauVerification.comparedFields': result.comparedFields,
        'bureauVerification.mismatchFlags':  result.mismatchFlags,
        'bureauVerification.verifiedBy':     initiatedBy,
      });
    }

    // ── Audit log ──────────────────────────────────────────────────────────
    await writeAuditLog({
      borrowerId,
      applicationId: applicationId || undefined,
      verificationType: 'BUREAU_PROFILE_VERIFICATION',
      status: isFatal ? 'FAILED' : 'SUCCESS',
      initiatedBy,
      requestPayload: { idNumber, surname, clientReference: applicationId },
      responsePayload: {
        verificationStatus: result.verificationStatus,
        bureauReference:    result.bureauReference,
        deceasedStatus:     result.deceasedStatus,
        safpsFlag:          result.safpsFlag,
        mismatchFlags:      result.mismatchFlags,
      },
    });

    // ── Socket events ──────────────────────────────────────────────────────
    try {
      const io = getIO();
      const room = borrowerId?.toString();

      if (isFatal) {
        io.to(room).emit('bureau-fraud-detected', {
          applicationId,
          deceasedStatus: result.deceasedStatus,
          safpsFlag: result.safpsFlag,
          message: result.deceasedStatus
            ? 'Bureau check: Deceased flag detected'
            : 'Bureau check: SAFPS fraud listing detected',
        });
        io.to(room).emit('bureau-verification-failed', { applicationId, message: result.responseMessage });
      } else if (hasWarnings) {
        io.to(room).emit('bureau-verification-warning', {
          applicationId,
          mismatchFlags: result.mismatchFlags,
          message: 'Bureau verification completed with data mismatches',
        });
      } else {
        io.to(room).emit('bureau-verification-completed', {
          applicationId,
          bureauReference: result.bureauReference,
          message: 'Bureau profile verified successfully',
        });
      }
    } catch {
      // Socket not initialized — non-fatal
    }

    return res.status(200).json({
      success: true,
      message: isFatal
        ? 'Bureau verification failed: fatal fraud indicator detected'
        : hasWarnings
          ? 'Bureau verification completed with warnings'
          : 'Bureau verification successful',
      data: {
        verificationStatus:         isFatal ? 'Failed' : result.verificationStatus,
        bureauReference:            result.bureauReference,
        verifiedFirstName:          result.verifiedFirstName,
        verifiedSurname:            result.verifiedSurname,
        verifiedPhone:              result.verifiedPhone,
        verifiedEmail:              result.verifiedEmail,
        verifiedEmployer:           result.verifiedEmployer,
        verifiedResidentialAddress: result.verifiedResidentialAddress,
        verifiedPostalAddress:      result.verifiedPostalAddress,
        deceasedStatus:  result.deceasedStatus,
        safpsFlag:       result.safpsFlag,
        haVerified:      result.haVerified,
        fraudFlags:      result.fraudFlags,
        addressHistory:  result.addressHistory,
        mismatchFlags:   result.mismatchFlags,
        comparedFields:  result.comparedFields,
        isFatal,
        hasWarnings,
      },
    });
  } catch (error) {
    console.error('[BUREAU Controller Error]:', error.message);

    await writeAuditLog({
      borrowerId,
      applicationId: applicationId || undefined,
      verificationType: 'BUREAU_PROFILE_VERIFICATION',
      status: 'ERROR',
      initiatedBy,
      requestPayload: { idNumber, surname },
      errorMessage: error.message,
    });

    return res.status(error.status || error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Bureau verification failed',
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 10. Admin Bureau Override
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PUT /api/verification/bureau-override/:applicationId
 * Admin only — override bureau mismatches / low-risk flags (not deceased/SAFPS without reason)
 */
exports.overrideBureauController = async (req, res) => {
  const { applicationId } = req.params;
  const { overrideReason } = req.body;
  const adminId = req.user?._id;

  if (!overrideReason?.trim()) {
    return res.status(400).json({ success: false, message: 'overrideReason is required' });
  }

  try {
    const application = await LoanApplication.findById(applicationId);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    await LoanApplication.findByIdAndUpdate(applicationId, {
      'bureauVerification.verificationStatus': 'Overridden',
      'bureauVerification.overrideReason': overrideReason.trim(),
      'bureauVerification.overrideBy':     adminId,
      'bureauVerification.overrideAt':     new Date(),
    });

    await writeAuditLog({
      borrowerId:       application.borrowerId || adminId,
      applicationId,
      verificationType: 'BUREAU_OVERRIDE',
      status:           'SUCCESS',
      initiatedBy:      adminId,
      requestPayload:   { overrideReason, applicationId },
      responsePayload:  { action: 'BUREAU_MANUAL_OVERRIDE', overrideBy: adminId },
    });

    try {
      const io = getIO();
      io.to(application.borrowerId?.toString()).emit('bureau-verification-completed', {
        applicationId,
        message: 'Bureau verification manually overridden by admin',
        overridden: true,
      });
    } catch {
      // Socket not initialized — non-fatal
    }

    return res.status(200).json({
      success: true,
      message: 'Bureau verification successfully overridden',
      data: { applicationId, overrideReason, overrideAt: new Date() },
    });
  } catch (error) {
    console.error('[Bureau Override Error]:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Override failed' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 11. Phone Verification — Contact To ID (Step 1.75)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/verification/phone-verification/:applicationId
 * Requires KYC (step 1) Verified/Overridden and Bureau not Rejected.
 * Body: { phoneNumber, idNumber, fullName }
 */
exports.verifyPhoneByApplicationController = async (req, res) => {
  const { applicationId } = req.params;
  const { phoneNumber, idNumber, fullName, borrowerId: bodyBorrowerId } = req.body;
  const initiatedBy = req.user?._id;

  if (!applicationId) return res.status(400).json({ success: false, message: 'applicationId is required' });
  if (!phoneNumber)   return res.status(400).json({ success: false, message: 'phoneNumber is required' });
  if (!idNumber)      return res.status(400).json({ success: false, message: 'idNumber is required' });

  if (!validateSAPhone(phoneNumber)) {
    return res.status(400).json({
      success: false,
      message: 'Enter a valid South African phone number.'
    });
  }

  try {
    // ── Load application and enforce sequential gates ──────────────────────
    const app = await LoanApplication.findById(applicationId)
      .select('borrowerId kycVerification bureauVerification phoneNumber fullName');

    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

    const nameToUse = fullName || app.fullName || '';
    if (!validateFullName(nameToUse)) {
      return res.status(400).json({
        success: false,
        message: 'Enter borrower full legal name.'
      });
    }

    const formattedName = formatFullName(nameToUse);

    const kycStatus    = app.kycVerification?.verificationStatus;
    const bureauStatus = app.bureauVerification?.verificationStatus;

    const kycPassed = kycStatus === 'Verified' || kycStatus === 'Overridden';
    if (!kycPassed) {
      if (isDevelopmentSandboxBypassEnabled()) {
        console.warn('[DEV SANDBOX BYPASS] Phone verification gate bypassed — KYC not verified.');
      } else {
        return res.status(400).json({
          success: false,
          message: 'Biometric KYC verification must be completed before phone verification.',
        });
      }
    }

    if (bureauStatus === 'Rejected') {
      if (isDevelopmentSandboxBypassEnabled()) {
        console.warn('[DEV SANDBOX BYPASS] Phone verification gate bypassed — bureau rejected.');
      } else {
        return res.status(400).json({
          success: false,
          message: 'Bureau verification has fatal indicators. Phone verification cannot proceed.',
        });
      }
    }

    const borrowerId = bodyBorrowerId || app.borrowerId || initiatedBy;

    console.log(`[PHONE Controller] Starting phone verification — Phone: ${phoneNumber} | App: ${applicationId}`);

    // ── Call Datanamix Contact To ID API ──────────────────────────────────
    const result = await callPhoneVerification({
      phoneNumber,
      idNumber,
      fullName:        formattedName,
      clientReference: applicationId,
    });

    // ── Persist to LoanApplication ─────────────────────────────────────────
    await LoanApplication.findByIdAndUpdate(applicationId, {
      'phoneVerification.verificationStatus':  result.verificationStatus,
      'phoneVerification.verifiedPhoneNumber': result.verifiedPhoneNumber,
      'phoneVerification.reportReference':     result.reportReference,
      'phoneVerification.ownershipMatched':    result.ownershipMatched,
      'phoneVerification.mismatchDetected':    result.mismatchDetected,
      'phoneVerification.mismatchReason':      result.mismatchReason,
      'phoneVerification.matchedConsumers':    result.matchedConsumers,
      'phoneVerification.verifiedAt':          new Date(),
      'phoneVerification.rawResponse':         result.rawResponse,
    });

    // ── Audit log ──────────────────────────────────────────────────────────
    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: result.verificationStatus === 'Verified' ? 'PHONE_VERIFICATION' : 'PHONE_VERIFICATION_FAILED',
      status:           result.verificationStatus === 'Verified' ? 'SUCCESS' : 'FAILED',
      initiatedBy,
      requestPayload:  { phoneNumber, idNumber, applicationId },
      responsePayload: {
        verificationStatus: result.verificationStatus,
        ownershipMatched:   result.ownershipMatched,
        mismatchDetected:   result.mismatchDetected,
        mismatchReason:     result.mismatchReason,
        reportReference:    result.reportReference,
      },
    });

    // ── Socket events ──────────────────────────────────────────────────────
    try {
      const io   = getIO();
      const room = borrowerId?.toString();

      if (result.verificationStatus === 'Verified') {
        io.to(room).emit('phone-verification-completed', {
          applicationId,
          ownershipMatched: result.ownershipMatched,
          mismatchDetected: result.mismatchDetected,
          message: result.mismatchDetected
            ? 'Phone verified with partial name match — please review'
            : 'Phone number ownership verified successfully',
        });
      } else {
        io.to(room).emit('phone-verification-failed', {
          applicationId,
          mismatchReason: result.mismatchReason,
          message: result.mismatchReason || 'Phone verification failed',
        });
      }
    } catch {
      // Socket not initialized — non-fatal
    }

    return res.status(200).json({
      success: true,
      message: result.verificationStatus === 'Verified'
        ? result.mismatchDetected
          ? 'Phone verified with partial name match'
          : 'Phone number ownership verified successfully'
        : result.mismatchReason || 'Phone verification failed',
      data: {
        verificationStatus:  result.verificationStatus,
        ownershipMatched:    result.ownershipMatched,
        mismatchDetected:    result.mismatchDetected,
        mismatchReason:      result.mismatchReason,
        verifiedPhoneNumber: result.verifiedPhoneNumber,
        reportReference:     result.reportReference,
        matchedConsumers:    result.matchedConsumers,
      },
    });
  } catch (error) {
    console.error('[PHONE Controller Error]:', error.message);

    const failApp = await LoanApplication.findById(applicationId).select('borrowerId').catch(() => null);
    const fallbackBorrowerId = failApp?.borrowerId || initiatedBy;

    await writeAuditLog({
      borrowerId:       fallbackBorrowerId,
      applicationId,
      verificationType: 'PHONE_VERIFICATION_FAILED',
      status:           'ERROR',
      initiatedBy,
      requestPayload:   { phoneNumber, idNumber, applicationId },
      errorMessage:     error.message,
    });

    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Phone verification failed',
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 12. Bank Account Verification — AVS Advanced (Step 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/verification/bank-verification/:applicationId
 * Requires KYC (step 1) Verified/Overridden and Bureau not Rejected.
 * Body: { accountHolder, bankName, accountNumber, branchCode, accountType,
 *         phoneNumber, emailAddress, idNumber }
 */
exports.verifyBankVerificationController = async (req, res) => {
  const { applicationId } = req.params;
  const {
    accountHolder, bankName, accountNumber, branchCode,
    accountType, phoneNumber, emailAddress, idNumber,
    borrowerId: bodyBorrowerId,
  } = req.body;
  const initiatedBy = req.user?._id;

  if (!applicationId) return res.status(400).json({ success: false, message: 'applicationId is required' });
  if (!accountNumber) return res.status(400).json({ success: false, message: 'accountNumber is required' });
  if (!idNumber)      return res.status(400).json({ success: false, message: 'idNumber is required' });

  try {
    const app = await LoanApplication.findById(applicationId)
      .select('borrowerId fullName idNumber phoneNumber emailAddress kycVerification bureauVerification bankVerification staffReview creditAssessment status');

    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

    const kycStatus    = app.kycVerification?.verificationStatus;
    const bureauStatus = app.bureauVerification?.verificationStatus;

    const kycPassed = kycStatus === 'Verified' || kycStatus === 'Overridden';
    if (!kycPassed) {
      if (isDevelopmentSandboxBypassEnabled()) {
        console.warn('[DEV SANDBOX BYPASS] Bank verification gate bypassed — KYC not verified.');
      } else {
        return res.status(400).json({
          success: false,
          message: 'Biometric KYC verification must be completed before bank verification.',
        });
      }
    }

    if (bureauStatus === 'Rejected') {
      if (isDevelopmentSandboxBypassEnabled()) {
        console.warn('[DEV SANDBOX BYPASS] Bank verification gate bypassed — bureau rejected.');
      } else {
        return res.status(400).json({
          success: false,
          message: 'Bureau verification has fatal indicators. Bank verification cannot proceed.',
        });
      }
    }

    const borrowerId = bodyBorrowerId || app.borrowerId || initiatedBy;

    // Load dynamic settings from SystemSettings
    const settings = await SystemSettings.findOne() || {};

    // Identity resolution:
    // - idNumber / phoneNumber / emailAddress: body (current form) takes priority — DB is fallback only
    //   because the draft application may have been created with older values
    // - fullName: from DB because the banking step form has no name field
    const borrowerFullName  = app.fullName       || '';
    const borrowerIdNumber  = idNumber           || app.idNumber      || '';
    const borrowerPhone     = phoneNumber        || app.phoneNumber   || '';
    const borrowerEmail     = emailAddress       || app.emailAddress  || '';

    console.log('[BANK VERIFY SOURCE DATA]', {
      source_body:  { idNumber, phoneNumber, emailAddress },
      source_db:    { idNumber: app.idNumber, phoneNumber: app.phoneNumber, emailAddress: app.emailAddress, fullName: app.fullName },
      resolved:     { fullName: borrowerFullName, idNumber: borrowerIdNumber, phoneNumber: borrowerPhone, email: borrowerEmail },
    });
    console.log(`[BANK Controller] Starting AVS Advanced — Account: ${accountNumber} | App: ${applicationId} | ID: ${borrowerIdNumber} | Name: ${borrowerFullName}`);

    const result = await callBankVerification({
      fullName:     borrowerFullName,
      bankName,
      accountNumber,
      branchCode,
      accountType,
      phoneNumber:  borrowerPhone,
      emailAddress: borrowerEmail,
      idNumber:     borrowerIdNumber,
      clientReference: applicationId,
    });

    // ── PDF Archiving & Hashing ─────────────────────────────────────────────
    let pdfReportPath = '';
    let pdfHash = '';
    let verificationVersion = 1;

    if (result.pdfReport && settings.bankPdfGenerationMode !== 'JSON_ONLY') {
      try {
        const pdfBuffer = Buffer.from(result.pdfReport, 'base64');
        const crypto = require('crypto');
        pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

        // Increment version number
        verificationVersion = (app.bankVerification?.verificationVersion || 0) + 1;

        const path = require('path');
        const fs = require('fs/promises');

        // Save PDF to storage/bureau-reports/<applicationId>/bank-verification/v<version>/report.pdf
        const storageDir = path.join(__dirname, '..', '..', 'storage', 'bureau-reports', applicationId.toString(), 'bank-verification', `v${verificationVersion}`);
        await fs.mkdir(storageDir, { recursive: true });

        const filePath = path.join(storageDir, 'report.pdf');
        await fs.writeFile(filePath, pdfBuffer);

        // Store relative path in DB
        pdfReportPath = path.join('storage', 'bureau-reports', applicationId.toString(), 'bank-verification', `v${verificationVersion}`, 'report.pdf');
        console.log(`[COMPLIANCE-AVS] Saved encrypted AVS PDF successfully to ${filePath} with hash: ${pdfHash}`);
      } catch (pdfErr) {
        console.error('⚠️ [COMPLIANCE-AVS ERROR] Storing bank verification PDF failed:', pdfErr.message);
      }
    }

    // Clean raw response before saving to MongoDB to prevent bloating
    if (result.pdfReport) result.pdfReport = undefined;
    if (result.rawResponse) {
      if (result.rawResponse.PDFReport) result.rawResponse.PDFReport = undefined;
      if (result.rawResponse.pdfReport) result.rawResponse.pdfReport = undefined;
    }

    // ── Auto Underwriting & Compliance Engine Linkage ───────────────────────
    let underwritingDecision = app.creditAssessment?.underwritingDecision || 'Auto Approve';
    let workflowRoute        = app.creditAssessment?.workflowRoute || 'Auto Approval Engine';
    let riskLevel            = app.staffReview?.riskLevel || 'Low';
    let appStatus            = app.status;

    const identityMatch = result.avs?.identityMatch;
    const accountOpen    = result.avs?.accountOpen;
    const verificationStatus = result.verificationStatus;

    if (identityMatch === 'No') {
      underwritingDecision = 'Decline';
      workflowRoute        = 'Rejection Desk';
      riskLevel            = 'Critical';
      appStatus            = 'Rejected';
    } else if (accountOpen === 'No') {
      underwritingDecision = 'Manual Review Required';
      riskLevel            = 'High';
      if (appStatus !== 'Rejected') appStatus = 'Pending Review';
    } else if (verificationStatus === 'VERIFIED_WITH_WARNINGS') {
      underwritingDecision = 'Manual Review Required';
      riskLevel            = 'Medium';
      workflowRoute        = 'Manual Review Queue';
      if (appStatus !== 'Rejected') appStatus = 'Pending Review';
    }

    // ── Persist to LoanApplication ─────────────────────────────────────────
    const updatedFields = {
      'bankVerification.verificationStatus':  result.verificationStatus,
      'bankVerification.status':              result.verificationStatus,
      'bankVerification.avsStatus':           result.avsStatus || result.verificationStatus,
      'bankVerification.statusMessage':       result.statusMessage,
      'bankVerification.verificationLevel':   riskLevel,
      'bankVerification.accountFound':        result.avs?.accountFound,
      'bankVerification.accountOpen':         result.avs?.accountOpen,
      'bankVerification.acceptsCredits':      result.avs?.acceptsCredits,
      'bankVerification.identityMatch':       result.avs?.identityMatch,
      'bankVerification.accountTypeMatch':    result.avs?.accountTypeMatch,
      'bankVerification.initialsMatch':       result.avs?.initialsMatch,
      'bankVerification.nameMatch':           result.avs?.nameMatch,
      'bankVerification.emailMatch':          result.avs?.emailMatch,
      'bankVerification.phoneMatch':          result.avs?.phoneMatch,
      'bankVerification.bankReference':       result.avs?.bankReference,
      'bankVerification.bankStatusCode':      result.avs?.bankStatusCode,
      'bankVerification.bankStatusMessage':   result.avs?.bankStatusMessage,
      'bankVerification.reportReference':     result.reportReference,
      'bankVerification.verifiedAt':          new Date(),
      'bankVerification.verificationTimestamp': result.verificationTimestamp || new Date(),
      'bankVerification.verifiedBankAccount': result.verifiedBankAccount,
      'bankVerification.verifiedBranchCode':  result.verifiedBranchCode,
      'bankVerification.verifiedAccountType': result.verifiedAccountType,
      'bankVerification.pdfReport':           undefined,
      'bankVerification.pdfReportPath':       pdfReportPath,
      'bankVerification.pdfHash':             pdfHash,
      'bankVerification.verificationVersion':  verificationVersion,
      'bankVerification.rawResponse':         result.rawResponse,
      'bankVerification.verifiedBy':          initiatedBy || app.borrowerId,
      'bankVerification.fraudIndicators':     identityMatch === 'No' ? ['IDENTITY_MISMATCH'] : [],
      'bankVerification.mismatchFlags':        [
        result.avs?.initialsMatch === 'No' ? 'INITIALS_MISMATCH' : null,
        result.avs?.phoneMatch === 'No' ? 'PHONE_MISMATCH' : null,
        result.avs?.emailMatch === 'No' ? 'EMAIL_MISMATCH' : null,
      ].filter(Boolean),
      'bankVerification.sandboxBypassEnabled': isDevelopmentSandboxBypassEnabled(),
      'bankVerification.environmentType':      settings.bankVerificationEnvironment || 'SANDBOX',
      'bankVerification.bypassReason':         isDevelopmentSandboxBypassEnabled() ? 'Sandbox test bypass active' : undefined,
      'bankVerification.bypassActivatedAt':    isDevelopmentSandboxBypassEnabled() ? new Date() : undefined,

      // Underwriting updates
      'creditAssessment.underwritingDecision': underwritingDecision,
      'creditAssessment.riskSeverity':         riskLevel,
      'creditAssessment.workflowRoute':        workflowRoute,
      underwritingDecision,
      workflowRoute,
      status:                                  appStatus,
      'staffReview.riskLevel':                 riskLevel,
    };

    await LoanApplication.findByIdAndUpdate(applicationId, updatedFields);

    const isAuditSuccess = ['VERIFIED', 'VERIFIED_WITH_WARNINGS', 'Verified', 'VerifiedWithWarnings'].includes(result.verificationStatus);

    // ── Immutable Audit Log ────────────────────────────────────────────────
    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: isAuditSuccess ? 'BANK_VERIFICATION' : 'BANK_VERIFICATION_FAILED',
      status:           isAuditSuccess ? 'SUCCESS' : 'FAILED',
      initiatedBy,
      requestPayload:  { accountNumber, idNumber, applicationId },
      responsePayload: {
        verificationStatus:     result.verificationStatus,
        statusMessage:          result.statusMessage,
        accountFound:           result.avs?.accountFound,
        accountOpen:            result.avs?.accountOpen,
        identityMatch:          result.avs?.identityMatch,
        reportReference:        result.reportReference,
        pdfVersion:             verificationVersion,
        pdfHash:                pdfHash,
        underwritingDecision:   underwritingDecision,
        riskLevel:              riskLevel
      },
    });

    // ── Socket events ──────────────────────────────────────────────────────
    try {
      const io   = getIO();
      const room = borrowerId?.toString();

      if (result.verificationStatus === 'Verified' || result.verificationStatus === 'VERIFIED') {
        io.to(room).emit('bank-verification-completed', {
          applicationId,
          message: 'Bank account ownership verified successfully',
        });
      } else if (result.verificationStatus === 'VerifiedWithWarnings' || result.verificationStatus === 'VERIFIED_WITH_WARNINGS') {
        io.to(room).emit('bank-verification-warning', {
          applicationId,
          message: result.statusMessage,
        });
      } else {
        io.to(room).emit('bank-verification-failed', {
          applicationId,
          message: result.statusMessage,
        });
      }
    } catch (e) {
      // Socket not initialized — non-fatal
    }

    return res.status(200).json({
      success: true,
      message: result.statusMessage || (['Verified', 'VERIFIED'].includes(result.verificationStatus)
        ? 'Bank account ownership verified successfully'
        : ['VerifiedWithWarnings', 'VERIFIED_WITH_WARNINGS'].includes(result.verificationStatus)
          ? 'Bank account verified with minor data mismatches'
          : 'Bank account verification failed'),
      data: {
        verificationStatus:  result.verificationStatus,
        statusMessage:       result.statusMessage,
        accountFound:        result.avs?.accountFound,
        accountOpen:         result.avs?.accountOpen,
        acceptsCredits:      result.avs?.acceptsCredits,
        identityMatch:       result.avs?.identityMatch,
        accountTypeMatch:    result.avs?.accountTypeMatch,
        initialsMatch:       result.avs?.initialsMatch,
        nameMatch:           result.avs?.nameMatch,
        emailMatch:          result.avs?.emailMatch,
        phoneMatch:          result.avs?.phoneMatch,
        bankReference:       result.avs?.bankReference,
        reportReference:     result.reportReference,
        verifiedBankAccount: result.verifiedBankAccount,
        verifiedBranchCode:  result.verifiedBranchCode,
      verifiedAccountType: result.verifiedAccountType,
        pdfReportPath,
        pdfHash,
        verificationVersion,
        underwritingDecision,
        riskSeverity:        riskLevel,
        sandboxBypassEnabled: isDevelopmentSandboxBypassEnabled(),
        environmentType:      settings.bankVerificationEnvironment || 'SANDBOX',
        bypassReason:         isDevelopmentSandboxBypassEnabled() ? 'Sandbox test bypass active' : undefined,
        bypassActivatedAt:    isDevelopmentSandboxBypassEnabled() ? new Date() : undefined,
      },
    });
  } catch (error) {
    console.error('[BANK Controller Error]:', error.message);

    const failApp = await LoanApplication.findById(applicationId).select('borrowerId').catch(() => null);
    const fallbackBorrowerId = failApp?.borrowerId || initiatedBy;

    await writeAuditLog({
      borrowerId:       fallbackBorrowerId,
      applicationId,
      verificationType: 'BANK_VERIFICATION_FAILED',
      status:           'ERROR',
      initiatedBy,
      requestPayload:   { accountNumber, idNumber, applicationId },
      errorMessage:     error.message,
    });

    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Bank verification failed',
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 12. Consumer Credit Report Search (Step 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/verification/consumer-credit-search
 * Requires KYC (step 1) passed and bureau (step 1.5) not rejected.
 * Body: { applicationId, idNumber, passportNumber? }
 */
exports.runCreditAssessmentController = async (req, res) => {
  const initiatedBy = req.user?._id;
  const { applicationId, idNumber, passportNumber, borrowerId: bodyBorrowerId, affordability: affordabilityBody } = req.body;

  const borrowerId = bodyBorrowerId || initiatedBy;

  if (!idNumber) return res.status(400).json({ success: false, message: 'idNumber is required' });

  // Helper functions locally scoped to avoid duplicate definitions
  const calculateAgeLocal = (dob) => {
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

  const parseEmploymentMonthsLocal = (val) => {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return val;
    const match = String(val).match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };

  try {
    let app = null;
    // ── Guard: KYC and bureau must be completed ────────────────────────────
    if (applicationId) {
      app = await LoanApplication.findById(applicationId);

      if (app) {
        const kycStatus    = app.kycVerification?.verificationStatus;
        const bureauStatus = app.bureauVerification?.verificationStatus;
        const phoneStatus  = app.phoneVerification?.verificationStatus;

        const kycPassed = kycStatus === 'Verified' || kycStatus === 'Overridden';
        if (!kycPassed) {
          if (isDevelopmentSandboxBypassEnabled()) {
            console.warn('[DEV SANDBOX BYPASS] Credit progression allowed — KYC not verified.');
          } else {
            return res.status(400).json({
              success: false,
              message: 'Biometric KYC verification must be completed before running credit assessment.',
            });
          }
        }

        if (bureauStatus === 'Rejected') {
          if (isDevelopmentSandboxBypassEnabled()) {
            console.warn('[DEV SANDBOX BYPASS] Credit progression allowed — bureau rejected.');
          } else {
            return res.status(400).json({
              success: false,
              message: 'Bureau verification has fatal indicators. Credit assessment cannot proceed.',
            });
          }
        }

        if (!phoneStatus || phoneStatus === 'Pending' || phoneStatus === 'Failed' || phoneStatus === 'Rejected') {
          if (isDevelopmentSandboxBypassEnabled()) {
            console.warn('[DEV SANDBOX BYPASS] Credit progression allowed — phone verification not completed.');
          } else {
            return res.status(400).json({
              success: false,
              message: 'Phone verification must be completed before running credit assessment.',
            });
          }
        }
      }
    }

    console.log(`[CREDIT Controller] Starting consumer credit search — ID: ${idNumber}`);

    const result = await callConsumerCreditSearch({
      idNumber,
      passportNumber: passportNumber || '',
      reference: applicationId || `CREDIT-${Date.now()}`,
    });

    // ── Rule Engine & Eligibility Engine & Workflow Routing ─────────────────
    const settings = await SystemSettings.findOne() || {};
    const borrower = app ? await Borrower.findOne({ $or: [{ _id: app.borrowerId }, { userId: app.borrowerId }] }) : null;

    // Fetch and assess parameters
    const totalIncome = Number(affordabilityBody?.income?.totalIncome || borrower?.monthlyNetSalary || 0);
    const taxes = Number(affordabilityBody?.expenses?.taxes || 0);
    const rentMortgage = Number(affordabilityBody?.expenses?.rentMortgage || 0);
    const debtRepayments = Number(affordabilityBody?.expenses?.debtRepayments || 0);
    const livingExpenses = Number(affordabilityBody?.expenses?.livingExpenses || 0);
    const totalExpenses = taxes + rentMortgage + debtRepayments + livingExpenses;

    const disposableIncome = totalIncome - totalExpenses;
    const dti = totalIncome > 0 ? ((debtRepayments + rentMortgage) / totalIncome) * 100 : 0;

    const minSalary = Number(settings.minSalaryRequirement ?? 5000);
    const maxDti = Number(settings.maxDtiPercentage ?? 40);
    const warningDtiThreshold = Number(settings.affordabilityWarningThreshold ?? 35);
    const minDisposable = Number(settings.minDisposableIncome ?? 2000);

    let ncrBenchmark = 0;
    if (totalIncome > 0) {
      if (totalIncome <= 800) {
        ncrBenchmark = totalIncome;
      } else if (totalIncome <= 6250) {
        ncrBenchmark = 800 + (totalIncome - 800) * 0.067;
      } else {
        ncrBenchmark = 1165 + (totalIncome - 6250) * 0.09;
      }
    }

    const rulesRun = {
      minSalary: totalIncome >= minSalary,
      dtiThreshold: dti <= maxDti,
      dtiWarning: dti >= warningDtiThreshold,
      disposableIncome: disposableIncome >= minDisposable,
      ncrLivingExpenses: livingExpenses >= ncrBenchmark,
      dhaVerified: app?.kycVerification?.verificationStatus === 'Verified' || app?.kycVerification?.verificationStatus === 'Overridden',
      ocrVerified: app?.documentVerificationStatus === 'Complete' || !settings.ocrRequired,
      amlCleared: app?.amlVerification?.verificationStatus === 'CLEARED' || !settings.amlRequired
    };

    const dob = borrower?.dateOfBirth || app?.dateOfBirth;
    const borrowerAge = calculateAgeLocal(dob);
    const minAge = Number(settings.minimumAge ?? 18);
    const maxAge = Number(settings.maximumAge ?? 65);
    const empMonths = parseEmploymentMonthsLocal(borrower?.yearsOfService ? borrower.yearsOfService * 12 : 6);
    const minEmpDuration = Number(settings.minEmploymentDuration ?? 6);

    const eligibilityRun = {
      ageRange: borrowerAge ? (borrowerAge >= minAge && borrowerAge <= maxAge) : true,
      employmentDuration: empMonths >= minEmpDuration,
      employmentType: settings.employmentType === 'Both' || !borrower?.employmentStatus ||
        (settings.employmentType === 'Employed' && ['Permanent', 'Contract'].includes(borrower.employmentStatus)) ||
        (settings.employmentType === 'Self Employed' && ['Self-Employed'].includes(borrower.employmentStatus)),
      employmentCategory: !borrower?.employmentStatus || (settings.employmentCategories || []).includes(borrower.employmentStatus),
      allowedProduct: !app?.loanType || (settings.allowedLoanProducts || []).includes(app.loanType)
    };

    let riskSeverity = 'Low';
    let warnings = [];

    if (!rulesRun.minSalary) {
      riskSeverity = 'High';
      warnings.push('Gross Income below minimum requirement');
    }
    if (!rulesRun.dtiThreshold) {
      riskSeverity = 'High';
      warnings.push('DTI ratio exceeds maximum allowed threshold');
    } else if (rulesRun.dtiWarning) {
      if (riskSeverity !== 'High') riskSeverity = 'Medium';
      warnings.push('DTI ratio is near the warning threshold');
    }
    if (!rulesRun.disposableIncome) {
      riskSeverity = 'High';
      warnings.push('Disposable Income below minimum required');
    }
    if (!rulesRun.ncrLivingExpenses) {
      if (riskSeverity !== 'High') riskSeverity = 'Medium';
      warnings.push('Living expenses fall below NCR survival buffer');
    }

    const matchedCount = result.matchedConsumers?.length || 0;
    if (matchedCount > 1) {
      riskSeverity = 'High';
      warnings.push('MULTIPLE CONSUMERS FOUND — MANUAL REVIEW RECOMMENDED');
    } else if (matchedCount === 0 || result.responseCode === 4) {
      if (riskSeverity !== 'High') riskSeverity = 'Medium';
      warnings.push('NO CREDIT CONSUMER FOUND');
    }

    let underwritingDecision = 'Auto Approve';
    if (riskSeverity === 'High' || riskSeverity === 'Critical') {
      underwritingDecision = 'Decline';
    } else if (riskSeverity === 'Medium' || matchedCount > 1 || matchedCount === 0) {
      underwritingDecision = 'Manual Review Required';
    }

    if (settings.enableAutoApprovalLogic === false && underwritingDecision === 'Auto Approve') {
      underwritingDecision = 'Manual Review Required';
    }

    let workflowRoute = 'Auto Approval Engine';
    if (underwritingDecision === 'Manual Review Required') {
      workflowRoute = 'Manual Review Queue';
    } else if (underwritingDecision === 'Decline') {
      workflowRoute = 'Rejection Desk';
    }

    if (matchedCount > 1 || riskSeverity === 'High') {
      workflowRoute = 'Risk Escalation Queue';
    }

    const isEligible = Object.values(eligibilityRun).every(val => val === true);
    const eligibilityStatus = isEligible ? 'Eligible' : 'Ineligible';

    const underwritingResult = {
      rulesRun,
      riskSeverity,
      underwritingDecision,
      warnings
    };

    const eligibilityResult = {
      eligibilityRun,
      eligibilityStatus
    };

    const workflowResult = {
      workflowRoute,
      reviewerAssignment: settings.enableAutoAssignment ? 'Auto-Assigned' : 'Manual',
      escalationTriggered: matchedCount > 1 || riskSeverity === 'High'
    };

    // Print mandated console logs
    console.log("UNDERWRITING RULE ENGINE EXECUTED:", JSON.stringify(underwritingResult, null, 2));
    console.log("ELIGIBILITY ENGINE RESULT:", JSON.stringify(eligibilityResult, null, 2));
    console.log("WORKFLOW ROUTING RESULT:", JSON.stringify(workflowResult, null, 2));

    // ── Persist to LoanApplication ─────────────────────────────────────────
    let currentHash = '';
    if (applicationId) {
      // Safe Auto-Heal Check
      const existingApp = await LoanApplication.findById(applicationId);
      if (existingApp && (existingApp.affordabilityOutcome === null || typeof existingApp.affordabilityOutcome !== 'object')) {
        console.log('[AUTO-HEAL] affordabilityOutcome initialized from null object.');
        await LoanApplication.findByIdAndUpdate(applicationId, {
          $set: {
            affordabilityOutcome: {
              debtToIncomeRatio: null,
              affordabilityStatus: null,
              disposableIncome: null,
              monthlyObligations: null,
              calculatedAt: null
            }
          }
        });
      }

      const updatedApp = await LoanApplication.findByIdAndUpdate(applicationId, {
        'creditAssessment.verificationStatus': result.verificationStatus,
        'creditAssessment.enquiryId':          result.enquiryId,
        'creditAssessment.enquiryResultId':    result.enquiryResultId,
        'creditAssessment.matchedConsumers':   result.matchedConsumers,
        'creditAssessment.reportReference':    result.reportReference,
        'creditAssessment.reportDate':         result.reportDate ? new Date(result.reportDate) : null,
        'creditAssessment.searchSuccess':      result.searchSuccess,
        'creditAssessment.responseCode':       result.responseCode,
        'creditAssessment.completedAt':        new Date(),
        'creditAssessment.underwritingDecision': underwritingDecision,
        'creditAssessment.riskSeverity':         riskSeverity,
        'creditAssessment.eligibilityStatus':    eligibilityStatus,
        'creditAssessment.workflowRoute':        workflowRoute,
        'affordabilityOutcome.income':           affordabilityBody?.income || {},
        'affordabilityOutcome.expenses':         affordabilityBody?.expenses || {},
        'affordabilityOutcome.disposableIncome':  affordabilityBody?.disposableIncome || 0,
        'affordabilityOutcome.debtToIncomeRatio': affordabilityBody?.debtToIncomeRatio || 0,
        'affordabilityOutcome.isNcrCompliant':    affordabilityBody?.isNcrCompliant || false
      }, { returnDocument: 'after' });

      if (updatedApp) {
        currentHash = generateVerificationHash(updatedApp, borrower);
        updatedApp.creditAssessment.verificationHash = currentHash;
        if (updatedApp.consumerCreditReport) {
          updatedApp.consumerCreditReport.verificationHash = currentHash;
        }
        await updatedApp.save();
      }
    }

    // ── Audit logs ──────────────────────────────────────────────────────────
    // Log CREDIT_REPORT_SEARCH legacy log
    await writeAuditLog({
      borrowerId,
      applicationId: applicationId || undefined,
      verificationType: 'CREDIT_REPORT_SEARCH',
      status: result.searchSuccess ? 'SUCCESS' : 'FAILED',
      initiatedBy,
      requestPayload: { idNumber, reference: applicationId },
      responsePayload: {
        verificationStatus:  result.verificationStatus,
        enquiryId:           result.enquiryId,
        enquiryResultId:     result.enquiryResultId,
        consumerCount:       result.matchedConsumers.length,
        reportReference:     result.reportReference,
      },
    });

    // Log search execution audit trail
    await writeAuditLog({
      borrowerId,
      applicationId: applicationId || undefined,
      verificationType: 'CREDIT_SEARCH_EXECUTION',
      status: result.searchSuccess ? 'SUCCESS' : 'FAILED',
      initiatedBy,
      riskSeverity,
      workflowRoute,
      requestPayload: { idNumber, reference: applicationId, affordability: affordabilityBody },
      responsePayload: {
        enquiryId: result.enquiryId,
        enquiryResultId: result.enquiryResultId,
        verificationHash: currentHash
      }
    });

    // Escalation trigger check
    if (workflowRoute === 'Risk Escalation Queue' || workflowRoute === 'FRAUD_QUEUE' || matchedCount > 1 || riskSeverity === 'High') {
      await writeAuditLog({
        borrowerId,
        applicationId: applicationId || undefined,
        verificationType: 'WORKFLOW_ESCALATION',
        status: 'SUCCESS',
        initiatedBy,
        riskSeverity,
        workflowRoute,
        requestPayload: { decision: underwritingDecision, reasons: warnings }
      });
    }

    // Manual review trigger check
    if (underwritingDecision === 'Manual Review Required' || underwritingDecision === 'Manual Review' || underwritingDecision === 'MANUAL_REVIEW') {
      await writeAuditLog({
        borrowerId,
        applicationId: applicationId || undefined,
        verificationType: 'MANUAL_REVIEW_TRIGGER',
        status: 'SUCCESS',
        initiatedBy,
        riskSeverity,
        workflowRoute,
        requestPayload: { decision: underwritingDecision, reasons: warnings }
      });
    }

    // ── Socket events ──────────────────────────────────────────────────────
    try {
      const io   = getIO();
      const room = borrowerId?.toString();

      if (result.searchSuccess) {
        io.to(room).emit('credit-search-completed', {
          applicationId,
          enquiryId:       result.enquiryId,
          enquiryResultId: result.enquiryResultId,
          consumerCount:   result.matchedConsumers.length,
          message: 'Consumer credit search completed successfully',
        });
      } else {
        io.to(room).emit('credit-search-failed', {
          applicationId,
          message: 'Consumer credit search failed',
        });
      }
    } catch {
      // Socket not initialized — non-fatal
    }

    return res.status(200).json({
      success: true,
      message: result.verificationStatus === 'Verified'
        ? 'Consumer credit search successful'
        : result.verificationStatus === 'Warning'
          ? 'Credit search completed — no matching consumer profile found'
          : 'Consumer credit search failed',
      data: {
        verificationStatus:  result.verificationStatus,
        enquiryId:           result.enquiryId,
        enquiryResultId:     result.enquiryResultId,
        matchedConsumers:    result.matchedConsumers,
        reportReference:     result.reportReference,
        reportDate:          result.reportDate,
        searchSuccess:       result.searchSuccess,
        responseCode:        result.responseCode,
        underwritingDecision,
        riskSeverity,
        eligibilityStatus,
        workflowRoute,
        consumerSearchExecuted: true,
        creditReportFetched: false,
        previousVerificationLoaded: false,
        verificationLastRunAt: new Date(),
        verificationHashValid: true
      },
    });
  } catch (error) {
    console.error('[CREDIT Controller Error]:', error.message);

    await writeAuditLog({
      borrowerId,
      applicationId: applicationId || undefined,
      verificationType: 'CREDIT_REPORT_SEARCH',
      status: 'ERROR',
      initiatedBy,
      requestPayload: { idNumber },
      errorMessage: error.message,
    });

    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Consumer credit search failed',
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 12. Admin Credit Assessment Override
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PUT /api/verification/credit-search-override/:applicationId
 */
exports.overrideCreditAssessmentController = async (req, res) => {
  const { applicationId } = req.params;
  const { overrideReason } = req.body;
  const adminId = req.user?._id;

  if (!overrideReason?.trim()) {
    return res.status(400).json({ success: false, message: 'overrideReason is required' });
  }

  try {
    const application = await LoanApplication.findById(applicationId);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    await LoanApplication.findByIdAndUpdate(applicationId, {
      'creditAssessment.verificationStatus': 'Verified',
      'creditAssessment.overrideReason':     overrideReason.trim(),
      'creditAssessment.overriddenBy':       adminId,
      'creditAssessment.overriddenAt':       new Date(),
    });

    await writeAuditLog({
      borrowerId:       application.borrowerId || adminId,
      applicationId,
      verificationType: 'CREDIT_REPORT_OVERRIDE',
      status:           'SUCCESS',
      initiatedBy:      adminId,
      requestPayload:   { overrideReason, applicationId },
      responsePayload:  { action: 'CREDIT_MANUAL_OVERRIDE', overrideBy: adminId },
    });

    return res.status(200).json({
      success: true,
      message: 'Credit assessment successfully overridden',
      data: { applicationId, overrideReason, overriddenAt: new Date() },
    });
  } catch (error) {
    console.error('[Credit Override Error]:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Override failed' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 13. Consumer Credit Report Result (Step 4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/verification/consumer-credit-report/:applicationId
 * Requires Consumer Credit Search (step 3) to be completed with valid enquiry IDs.
 */
exports.fetchConsumerCreditReportController = async (req, res) => {
  const { applicationId } = req.params;
  const initiatedBy       = req.user?._id;

  if (!applicationId) {
    return res.status(400).json({ success: false, message: 'applicationId is required' });
  }

  try {
    // ── Load application and validate prerequisites ────────────────────────
    const app = await LoanApplication.findById(applicationId)
      .select('borrowerId kycVerification creditAssessment consumerCreditReport');

    if (!app) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const kycStatus = app.kycVerification?.verificationStatus;
    const kycPassed = kycStatus === 'Verified' || kycStatus === 'Overridden';
    if (!kycPassed) {
      if (isDevelopmentSandboxBypassEnabled()) {
        console.warn('[DEV SANDBOX BYPASS] Credit report fetch allowed — KYC not verified.');
      } else {
        return res.status(400).json({
          success: false,
          message: 'Biometric KYC verification must be completed before fetching the credit report.',
        });
      }
    }

    const creditSearch = app.creditAssessment;
    const enquiryId       = creditSearch?.enquiryId;
    const enquiryResultId = creditSearch?.enquiryResultId;

    if (!enquiryId || !enquiryResultId) {
      return res.status(400).json({
        success: false,
        message: 'Consumer Credit Search must be completed with valid Enquiry IDs before fetching the full report.',
      });
    }

    const borrowerId = app.borrowerId || initiatedBy;

    console.log(`[CREDIT-RESULT Controller] Fetching full report — EnquiryID: ${enquiryId}`);

    // ── Call Datanamix Consumer Result API ────────────────────────────────
    const result = await callConsumerCreditResult({
      enquiryId,
      enquiryResultId,
      clientReference: applicationId,
    });

    const verificationStatus = result.success ? 'Verified' : 'Failed';

    // ── Persist to LoanApplication ─────────────────────────────────────────
    await LoanApplication.findByIdAndUpdate(applicationId, {
      'consumerCreditReport.verificationStatus':  verificationStatus,
      'consumerCreditReport.completedAt':         new Date(),
      'consumerCreditReport.reportReference':     result.reportReference,
      'consumerCreditReport.reportDate':          result.reportDate,
      'consumerCreditReport.enquiryId':           enquiryId,
      'consumerCreditReport.enquiryResultId':     enquiryResultId,
      'consumerCreditReport.scoring':             result.scoring,
      'consumerCreditReport.debtSummary':         result.debtSummary,
      'consumerCreditReport.fraudIndicators':     result.fraudIndicators,
      'consumerCreditReport.underwriting':        result.underwriting,
      'consumerCreditReport.consumerDetails':     result.consumerDetails,
      'consumerCreditReport.accountSummary':      result.accountSummary,
      'consumerCreditReport.adverseInformation':  result.adverseInformation,
      'consumerCreditReport.properties':          result.properties,
      'consumerCreditReport.directorships':       result.directorships,
      'consumerCreditReport.addressHistory':      result.addressHistory,
      'consumerCreditReport.contactHistory':      result.contactHistory,
      'consumerCreditReport.emailHistory':        result.emailHistory,
      'consumerCreditReport.employmentHistory':   result.employmentHistory,
      'consumerCreditReport.enquiryHistory':      result.enquiryHistory,
      'consumerCreditReport.monthlyPaymentHistory': result.monthlyPaymentHistory,
      'consumerCreditReport.pdfReport':           result.pdfReport,
      'consumerCreditReport.rawResponse':         result.rawResponse,
    });

    // ── Audit log ──────────────────────────────────────────────────────────
    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: 'CREDIT_REPORT_RESULT',
      status: result.success ? 'SUCCESS' : 'FAILED',
      initiatedBy,
      requestPayload: { enquiryId, enquiryResultId, applicationId },
      responsePayload: {
        verificationStatus,
        score:          result.scoring?.finalScore,
        riskCategory:   result.underwriting?.riskCategory,
        decision:       result.underwriting?.level,
        judgements:     result.debtSummary?.judgementCount,
        defaults:       result.debtSummary?.defaultListingCount,
        reportReference: result.reportReference,
      },
    });

    // ── Socket events ──────────────────────────────────────────────────────
    try {
      const io   = getIO();
      const room = borrowerId?.toString();

      io.to(room).emit('credit-report-completed', {
        applicationId,
        score:        result.scoring?.finalScore,
        riskCategory: result.underwriting?.riskCategory,
        decision:     result.underwriting?.level,
        message:      'Full consumer credit report retrieved',
      });

      if (result.underwriting?.level === 'DECLINE') {
        io.to(room).emit('credit-report-decline-flag', {
          applicationId,
          reasons: result.underwriting.reasons,
        });
      }
    } catch {
      // Socket not initialized — non-fatal
    }

    return res.status(200).json({
      success: true,
      message: 'Consumer credit report retrieved successfully',
      data: {
        verificationStatus,
        reportReference:    result.reportReference,
        reportDate:         result.reportDate,
        scoring:            result.scoring,
        debtSummary:        result.debtSummary,
        fraudIndicators:    result.fraudIndicators,
        underwriting:       result.underwriting,
        consumerDetails:    result.consumerDetails,
        accountSummary:     result.accountSummary,
        adverseInformation: result.adverseInformation,
        properties:         result.properties,
        directorships:      result.directorships,
        addressHistory:     result.addressHistory,
        employmentHistory:  result.employmentHistory,
        enquiryHistory:     result.enquiryHistory,
        monthlyPaymentHistory: result.monthlyPaymentHistory,
      },
    });
  } catch (error) {
    console.error('[CREDIT-RESULT Controller Error]:', error.message);

    // Attempt to look up borrowerId for audit even on failure
    const failApp = await LoanApplication.findById(applicationId).select('borrowerId').catch(() => null);
    const fallbackBorrowerId = failApp?.borrowerId || initiatedBy;

    await writeAuditLog({
      borrowerId:       fallbackBorrowerId,
      applicationId,
      verificationType: 'CREDIT_REPORT_RESULT_FAILED',
      status:           'ERROR',
      initiatedBy,
      requestPayload:   { applicationId },
      errorMessage:     error.message,
    });

    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to fetch consumer credit report',
    });
  }
 };

/**
 * 14. AML & Sanctions screening controller for loan application review
 * POST /api/verification/aml-screening/:applicationId
 */
exports.verifyAMLScreeningController = async (req, res) => {
  const { applicationId } = req.params;
  const initiatedBy = req.user ? req.user._id : null;

  if (!applicationId) {
    return res.status(400).json({ success: false, message: 'applicationId is required' });
  }

  // 1. Log incoming req.body
  console.log('[AML SOURCE DATA]:', req.body);

  // 2. Validate required fields & 3. Reject empty payloads
  if (!req.body || Object.keys(req.body).length === 0 || !req.body.fullName || !req.body.idNumber) {
    return res.status(400).json({
      success: false,
      message: "Missing required AML screening fields"
    });
  }

  const { fullName, idNumber } = req.body;

  try {
    const app = await LoanApplication.findById(applicationId);
    if (!app) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const borrowerId = app.borrowerId || initiatedBy;
    const room = borrowerId?.toString();

    // Socket: AML_STARTED
    try {
      const io = getIO();
      io.to(room).emit('AML_STARTED', { applicationId, message: 'AML & Sanctions watchlist screening started.' });
    } catch (e) {}

    console.log(`[AML Controller] Screening starting for application: ${applicationId} | Borrower: ${fullName}`);

    // Update status to VERIFYING in DB
    await LoanApplication.findByIdAndUpdate(applicationId, {
      'amlVerification.verificationStatus': 'VERIFYING'
    });

    // 4. Generate proper Datanamix request payload (handled inside callAMLVerification)
    const result = await callAMLVerification({
      idNumber: idNumber.trim(),
      fullName: fullName.trim(),
      clientReference: applicationId
    });

    // Save details inside LoanApplication model
    await LoanApplication.findByIdAndUpdate(applicationId, {
      'amlVerification.verificationStatus': result.verificationStatus,
      'amlVerification.amlScore': result.amlScore,
      'amlVerification.found': result.found,
      'amlVerification.pepMatch': result.pepMatch,
      'amlVerification.sanctionsMatch': result.sanctionsMatch,
      'amlVerification.terrorMatch': result.terrorMatch,
      'amlVerification.fraudMatch': result.fraudMatch,
      'amlVerification.adverseMediaMatch': result.adverseMediaMatch,
      'amlVerification.ofacMatch': result.ofacMatch,
      'amlVerification.fatfMatch': result.fatfMatch,
      'amlVerification.riskLevel': result.riskLevel,
      'amlVerification.riskReason': result.riskReason,
      'amlVerification.reportReference': result.reportReference,
      'amlVerification.clientReference': result.clientReference,
      'amlVerification.matchCount': result.matchCount,
      'amlVerification.matchedEntities': result.matchedEntities,
      'amlVerification.screeningDate': result.screeningDate,
      'amlVerification.rawResponse': result.rawResponse,
      'amlVerification.pdfReport': result.pdfReport,
      'amlVerification.sanctionsStatus': result.sanctionsStatus,
      'amlVerification.complianceDecision': result.complianceDecision,
      'amlVerification.isBlocked': result.isBlocked,
      'amlVerification.screeningTimestamp': result.screeningTimestamp
    });

    // Store AML results in AMLCheck collection
    await AMLCheck.create({
      borrowerId,
      pepStatusDetected: result.pepMatch || false,
      sanctionStatusDetected: result.sanctionsMatch || false,
      crimeRecordDetected: result.terrorMatch || result.fraudMatch || false,
      riskScore: result.amlScore || 0,
      matchDetails: (result.matchedEntities || []).map(m => ({
        listName: m.source,
        matchedName: m.matchName,
        matchConfidence: m.confidenceScore,
        details: m
      })),
      screeningRawResponse: result.rawResponse || {},
      screeningDate: result.screeningDate || new Date(),
      complianceOutcome: result.verificationStatus === 'CLEARED' ? 'PASSED' : (result.complianceDecision === 'AUTO_REJECT' ? 'FAILED' : 'REFERRED'),
      notes: result.riskReason
    });

    await writeAuditLog({
      borrowerId,
      applicationId,
      verificationType: result.verificationStatus === 'FAILED' ? 'AML_SCREENING_FAILED' : 'AML_SCREENING',
      status: result.verificationStatus === 'FAILED' ? 'FAILED' : 'SUCCESS',
      initiatedBy,
      requestPayload: { idNumber: app.idNumber, fullName: app.fullName, applicationId },
      responsePayload: {
        verificationStatus: result.verificationStatus,
        riskLevel: result.riskLevel,
        matchCount: result.matchCount,
        reportReference: result.reportReference
      }
    });

    try {
      const io = getIO();
      if (result.complianceDecision === 'AUTO_REJECT' || result.verificationStatus === 'AUTO_REJECT' || result.verificationStatus === 'HIGH_RISK') {
        io.to(room).emit('AML_HIGH_RISK', {
          applicationId,
          message: 'FATAL COMPLIANCE RISK: Borrower matched against restricted sanctions or terror databases.',
          riskReason: result.riskReason
        });
      } else if (result.verificationStatus === 'FAILED') {
        io.to(room).emit('AML_FAILED', {
          applicationId,
          message: 'AML watchlists screening failed. Please retry.'
        });
      } else {
        io.to(room).emit('AML_COMPLETED', {
          applicationId,
          verificationStatus: result.verificationStatus,
          riskLevel: result.riskLevel,
          matchCount: result.matchCount,
          message: 'AML watchlists screening completed successfully.'
        });
      }
    } catch (e) {}

    return res.status(200).json({
      success: true,
      message: `AML watchlists screening completed with status: ${result.verificationStatus}`,
      data: {
        verificationStatus: result.verificationStatus,
        riskLevel: result.riskLevel,
        found: result.found,
        matchCount: result.matchCount,
        reportReference: result.reportReference,
        riskReason: result.riskReason,
        matchedEntities: result.matchedEntities,
        amlScore: result.amlScore,
        complianceDecision: result.complianceDecision,
        sanctionsStatus: result.sanctionsStatus,
        isBlocked: result.isBlocked,
        ofacMatch: result.ofacMatch,
        sanctionsMatch: result.sanctionsMatch,
        terrorMatch: result.terrorMatch,
        pepMatch: result.pepMatch,
        fatfMatch: result.fatfMatch,
        adverseMediaMatch: result.adverseMediaMatch
      }
    });

  } catch (error) {
    console.error('❌ [AML Controller Error]:', error.message);

    await writeAuditLog({
      borrowerId: req.user?._id || initiatedBy,
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
      message: error.message || 'Error occurred during AML screening.'
    });
  }
};

/**
 * Get active development sandbox bypass configuration.
 */
exports.getSandboxBypassConfig = (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      sandboxBypass: {
        sequentialGating: isDevelopmentSandboxBypassEnabled(),
        nextStepBypass: isDevelopmentNextStepBypassEnabled()
      }
    }
  });
};

/**
 * Clear previous credit assessment and report data on application modifications
 */
exports.resetCreditAssessmentController = async (req, res) => {
  const { applicationId } = req.params;
  
  if (!applicationId) {
    return res.status(400).json({ success: false, message: 'applicationId is required' });
  }

  try {
    const app = await LoanApplication.findById(applicationId);
    if (!app) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    // Reset credit assessment subdocument
    app.creditAssessment = {
      verificationStatus: 'Pending',
      enquiryId: null,
      enquiryResultId: null,
      matchedConsumers: [],
      reportReference: null,
      reportDate: null,
      searchSuccess: false,
      responseCode: null,
      underwritingDecision: null,
      riskSeverity: null,
      eligibilityStatus: null,
      workflowRoute: null,
      completedAt: null,
      verificationHash: null
    };

    // Reset root level consumer report indicators
    app.consumerCreditScore = null;
    app.consumerRiskCategory = null;
    app.consumerDebtSummary = {
      totalOutstandingDebt: null,
      totalMonthlyInstallment: null,
      totalArrearsAmount: null,
      totalAdverseAmount: null,
      judgementCount: 0,
      courtNoticeCount: 0,
      defaultListingCount: 0,
      highestMonthsInArrears: 0,
      activeAccountsCount: 0,
      propertyOwnershipCount: 0
    };
    app.fraudIndicators = {
      safpsListed: false,
      deceasedStatus: false,
      debtReviewStatus: false,
      homeAffairsVerified: false
    };
    app.affordabilityOutcome = {};
    app.underwritingDecision = null;
    app.workflowRoute = null;
    app.bureauRecommendation = null;
    app.bureauReportFetchedAt = null;

    // Reset legacy/nested consumerCreditReport subdocument
    app.consumerCreditReport = {
      verificationStatus: 'Pending',
      completedAt: null,
      reportReference: null,
      reportDate: null,
      enquiryId: null,
      enquiryResultId: null,
      scoring: {},
      debtSummary: {},
      fraudIndicators: {},
      underwriting: {
        level: null,
        riskCategory: null,
        reasons: []
      },
      consumerDetails: {},
      accountSummary: [],
      adverseInformation: {
        judgments: [],
        defaults: [],
        sequestration: [],
        adminOrders: [],
        rehabilitation: []
      },
      properties: [],
      directorships: [],
      addressHistory: [],
      contactHistory: [],
      emailHistory: [],
      employmentHistory: [],
      enquiryHistory: [],
      monthlyPaymentHistory: [],
      pdfReport: null,
      rawResponse: null,
      verificationHash: null
    };

    app.consumerCreditReportRaw = null;

    await app.save();

    console.log(`[CREDIT RESET] Reset credit assessment state for Application: ${applicationId}`);

    // Log CREDIT_RESET audit transaction
    await writeAuditLog({
      borrowerId: app.borrowerId,
      applicationId: app._id,
      verificationType: 'CREDIT_RESET',
      status: 'SUCCESS',
      initiatedBy: req.user?._id || app.borrowerId,
      requestPayload: { applicationId }
    });

    return res.status(200).json({
      success: true,
      message: 'Credit assessment state reset successfully',
      data: {
        consumerSearchExecuted: false,
        creditReportFetched: false,
        previousVerificationLoaded: false,
        verificationLastRunAt: null
      }
    });

  } catch (error) {
    console.error('❌ [Credit Assessment Reset Error]:', error.message);
    
    // Log CREDIT_RESET failure
    try {
      const failApp = await LoanApplication.findById(applicationId).select('borrowerId').catch(() => null);
      if (failApp) {
        await writeAuditLog({
          borrowerId: failApp.borrowerId,
          applicationId: failApp._id,
          verificationType: 'CREDIT_RESET',
          status: 'ERROR',
          initiatedBy: req.user?._id || failApp.borrowerId,
          errorMessage: error.message
        });
      }
    } catch (e) {}

    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to reset credit assessment state.'
    });
  }
};

/**
 * @desc    Securely stream the bank verification PDF
 * @route   GET /api/verification/bank-report-pdf/:applicationId
 * @access  Private (Admin, Staff, Underwriter only)
 */
exports.getBankReportPdfController = async (req, res) => {
  const { applicationId } = req.params;
  const userId = req.user ? req.user._id : null;
  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  try {
    const app = await LoanApplication.findById(applicationId).select('bankVerification');
    if (!app || !app.bankVerification || !app.bankVerification.pdfReportPath) {
      return res.status(404).json({ success: false, message: 'No bank verification PDF found for this application.' });
    }

    const path = require('path');
    const fsSync = require('fs');

    // Resolve the path relative to Backend root
    const filePath = path.join(__dirname, '..', '..', app.bankVerification.pdfReportPath);
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Bank verification PDF file not found on disk.' });
    }

    // Set headers for secure streaming inline
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="bank_verification_report.pdf"');

    // Stream the file chunk by chunk without loading into memory
    const readStream = fsSync.createReadStream(filePath);
    readStream.pipe(res);
  } catch (error) {
    console.error('[STREAM BANK PDF ERROR]:', error.message);
    res.status(500).json({ success: false, message: 'Error streaming bank verification report PDF.' });
  }
};

/**
 * @desc    Securely download the bank verification PDF
 * @route   GET /api/verification/download-bank-report/:applicationId
 * @access  Private (Admin, Staff, Underwriter only)
 */
exports.downloadBankReportController = async (req, res) => {
  const { applicationId } = req.params;

  try {
    const app = await LoanApplication.findById(applicationId).select('bankVerification');
    if (!app || !app.bankVerification || !app.bankVerification.pdfReportPath) {
      return res.status(404).json({ success: false, message: 'No bank verification PDF found for download.' });
    }

    const path = require('path');
    const fsSync = require('fs');

    const filePath = path.join(__dirname, '..', '..', app.bankVerification.pdfReportPath);
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Bank verification PDF file not found on disk.' });
    }

    const fileVersion = app.bankVerification.verificationVersion || 1;

    // Set headers for download as attachment
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="bank-avs-report-v${fileVersion}.pdf"`);

    const readStream = fsSync.createReadStream(filePath);
    readStream.pipe(res);
  } catch (error) {
    console.error('[DOWNLOAD BANK PDF ERROR]:', error.message);
    res.status(500).json({ success: false, message: 'Error downloading bank verification report PDF.' });
  }
};

