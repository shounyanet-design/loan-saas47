/**
 * Datanamix Verification Routing System
 * Secures routing bounds and validates payloads prior to launching checks.
 */

const express = require('express');
const router = express.Router();

const {
  verifyIdentityController,
  verifyFaceLivenessController,
  getFaceSessionTokenController,
  verifyBankController,
  verifyCreditController,
  verifyPhoneController,
  verifyAMLController,
  verifyBorrowerKYCController,
  overrideKYCController,
  verifyAddressProfileController,
  overrideBureauController,
  verifyPhoneByApplicationController,
  verifyBankVerificationController,
  runCreditAssessmentController,
  overrideCreditAssessmentController,
  getSandboxBypassConfig,
  resetCreditAssessmentController,
  getBankReportPdfController,
  downloadBankReportController,
} = require('../controllers/verification.controller');

const {
  fetchConsumerCreditReportController,
  getCreditReportPdfController,
  downloadCreditReportController,
  getCreditReportHistoryController,
  logPrintEventController
} = require('../controllers/verification/consumerCreditReportController');

const {
  verifyAMLScreeningController,
  getAmlReportPdfController,
  downloadAmlReportController
} = require('../controllers/verification/amlScreening.controller');

const { protectVerification } = require('../middleware/auth.middleware');
const { requireConsent, validateProfileData } = require('../middleware/verification.middleware');
const multer = require('multer');

// Memory-storage multer for KYC image uploads (no disk I/O, consistent with uploadMiddleware)
const kycUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// Apply protection to all integration routes
router.use(protectVerification);

/**
 * @route   GET /api/verification/sandbox-bypass
 * @desc    Get active development sandbox bypass configuration
 * @access  Private
 */
router.get('/sandbox-bypass', getSandboxBypassConfig);

/**

 * @route   POST /api/verification/identity
 * @desc    Validate borrower's DHA ID number & match photo
 * @access  Private
 */
router.post(
  '/identity',
  validateProfileData(['borrowerId', 'idNumber', 'fullName']),
  verifyIdentityController
);

/**
 * @route   POST /api/verification/face-liveness
 * @desc    Validate biometric liveness session (FaceTec 3D)
 * @access  Private
 */
router.post(
  '/face-liveness',
  validateProfileData(['borrowerId', 'faceScan', 'sessionId']),
  verifyFaceLivenessController
);

/**
 * @route   GET /api/verification/face-session-token
 * @desc    Get a new FaceTec SDK session token
 * @access  Private
 */
router.get('/face-session-token', getFaceSessionTokenController);

/**
 * @route   POST /api/verification/bank
 * @desc    Account Holder Verification Advanced (AHV) checks
 * @access  Private
 */
router.post(
  '/bank',
  validateProfileData(['borrowerId', 'bankName', 'accountNumber', 'idNumber', 'accountHolderName']),
  verifyBankController
);

/**
 * @route   POST /api/verification/credit
 * @desc    Pull Universal Consumer Credit Bureau Report
 * @access  Private
 */
router.post(
  '/credit',
  requireConsent, // Mandate explicit consent check on DB
  validateProfileData(['borrowerId', 'idNumber', 'fullName', 'consentAccepted']),
  verifyCreditController
);

/**
 * @route   POST /api/verification/phone
 * @desc    Carrier Identity phone matching checks
 * @access  Private
 */
router.post(
  '/phone',
  validateProfileData(['borrowerId', 'phoneNumber', 'idNumber', 'fullName']),
  verifyPhoneController
);

/**
 * @route   POST /api/verification/aml
 * @desc    PEP, Sanctions lists, and Crime data compliance lookup
 * @access  Private
 */
router.post(
  '/aml',
  validateProfileData(['borrowerId', 'idNumber', 'fullName']),
  verifyAMLController
);

/**
 * @route   POST /api/verification/profile-id-photo-match
 * @desc    KYC: Datanamix Profile Plus ID Photo Match (Offline) — primary KYC gate
 * @access  Private — multipart/form-data: idFrontImage required, selfieImage + idBackImage optional
 */
router.post(
  '/profile-id-photo-match',
  kycUpload.fields([
    { name: 'idFrontImage', maxCount: 1 },
    { name: 'selfieImage',  maxCount: 1 },
    { name: 'idBackImage',  maxCount: 1 },
  ]),
  verifyBorrowerKYCController
);

/**
 * @route   PUT /api/verification/kyc-override/:applicationId
 * @desc    Admin manual override of a failed KYC — always creates an audit log
 * @access  Private (admin only enforced at controller level via req.user)
 */
router.put('/kyc-override/:applicationId', overrideKYCController);
router.post('/kyc-override/:applicationId', overrideKYCController);

/**
 * @route   POST /api/verification/address-plus-profile-idv
 * @desc    Bureau: Address Plus Profile IDV — Step 1.5 after biometric KYC
 * @access  Private — JSON body: { applicationId, idNumber, surname, ... }
 */
router.post('/address-plus-profile-idv', verifyAddressProfileController);

/**
 * @route   PUT /api/verification/bureau-override/:applicationId
 * @desc    Admin override of bureau mismatch / low-risk flags
 * @access  Private (admin only enforced at controller level)
 */
router.put('/bureau-override/:applicationId', overrideBureauController);

/**
 * @route   POST /api/verification/phone-verification/:applicationId
 * @desc    Step 1.75: Datanamix Contact To ID — verifies phone number ownership against SA ID
 * @access  Private — requires KYC passed + bureau not rejected
 */
router.post('/phone-verification/:applicationId', verifyPhoneByApplicationController);

/**
 * @route   POST /api/verification/bank-verification/:applicationId
 * @desc    Step 3: Datanamix AVS Advanced — verifies bank account ownership against SA ID
 * @access  Private — requires KYC passed + bureau not rejected
 */
router.post('/bank-verification/:applicationId', verifyBankVerificationController);

/**
 * @route   POST /api/verification/consumer-credit-search
 * @desc    Step 2: Datanamix Consumer Credit Search — generates EnquiryID + EnquiryResultID
 * @access  Private — requires KYC passed + bureau not rejected + phone verified
 */
router.post('/consumer-credit-search', runCreditAssessmentController);

/**
 * @route   PUT /api/verification/credit-search-override/:applicationId
 * @desc    Admin override of a failed/warning credit assessment
 * @access  Private (admin only enforced at controller level)
 */
router.put('/credit-search-override/:applicationId', overrideCreditAssessmentController);

/**
 * @route   POST /api/verification/consumer-credit-report/:applicationId
 * @desc    Step 4: Fetch full Datanamix Consumer Credit Report Result
 * @access  Private — requires credit search (step 3) with valid enquiry IDs
 */
router.post('/consumer-credit-report/:applicationId', fetchConsumerCreditReportController);

/**
 * @route   POST /api/verification/reset-credit-assessment/:applicationId
 * @desc    Clear previous credit assessment/report data on application modifications
 * @access  Private
 */
router.post('/reset-credit-assessment/:applicationId', resetCreditAssessmentController);

/**
 * @route   POST /api/verification/aml-screening/:applicationId
 * @desc    Step 5: Perform AML, watchlists, PEP, and sanctions screening
 * @access  Private
 */
router.post('/aml-screening/:applicationId', verifyAMLScreeningController);

// Local Role Authorization Helper
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Direct PDF access restricted to Staff, Admin, or Underwriter roles.'
      });
    }
    next();
  };
};

/**
 * @route   GET /api/verification/credit-report-pdf/:applicationId
 * @desc    Securely stream the watermarked credit report PDF
 * @access  Private (Admin/Staff only)
 */
router.get('/credit-report-pdf/:applicationId', authorizeRoles('admin', 'staff'), getCreditReportPdfController);

/**
 * @route   GET /api/verification/download-credit-report/:applicationId
 * @desc    Securely stream download of the credit report PDF
 * @access  Private (Admin/Staff only)
 */
router.get('/download-credit-report/:applicationId', authorizeRoles('admin', 'staff'), downloadCreditReportController);

/**
 * @route   GET /api/verification/credit-report-history/:applicationId
 * @desc    Get credit report document audit and version history
 * @access  Private (Admin/Staff only)
 */
router.get('/credit-report-history/:applicationId', authorizeRoles('admin', 'staff'), getCreditReportHistoryController);

/**
 * @route   POST /api/verification/log-print-event/:applicationId
 * @desc    Log a document print compliance audit event
 * @access  Private (Admin/Staff only)
 */
router.post('/log-print-event/:applicationId', authorizeRoles('admin', 'staff'), logPrintEventController);

/**
 * @route   GET /api/verification/bank-report-pdf/:applicationId
 * @desc    Securely stream the bank verification PDF
 * @access  Private (Admin/Staff/Underwriter only)
 */
router.get('/bank-report-pdf/:applicationId', authorizeRoles('admin', 'staff', 'underwriter'), getBankReportPdfController);

/**
 * @route   GET /api/verification/download-bank-report/:applicationId
 * @desc    Securely download the bank verification PDF
 * @access  Private (Admin/Staff/Underwriter only)
 */
router.get('/download-bank-report/:applicationId', authorizeRoles('admin', 'staff', 'underwriter'), downloadBankReportController);

/**
 * @route   GET /api/verification/aml-report-pdf/:applicationId
 * @desc    Securely stream the AML watchlist report PDF
 * @access  Private (Admin/Staff only)
 */
router.get('/aml-report-pdf/:applicationId', authorizeRoles('admin', 'staff'), getAmlReportPdfController);

/**
 * @route   GET /api/verification/download-aml-report/:applicationId
 * @desc    Securely download the AML watchlist report PDF
 * @access  Private (Admin/Staff only)
 */
router.get('/download-aml-report/:applicationId', authorizeRoles('admin', 'staff'), downloadAmlReportController);

module.exports = router;
