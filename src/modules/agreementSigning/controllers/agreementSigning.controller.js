const asyncHandler = require('express-async-handler');
const agreementSigningService = require('../services/agreementSigning.service');
const AgreementOTP = require('../models/AgreementOTP');
const LoanApplication = require('../../../models/LoanApplication');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');

/**
 * @desc    Generate Loan Agreement
 * @route   POST /api/agreement/generate
 * @access  Private (Admin/Staff)
 */
const generateAgreement = asyncHandler(async (req, res) => {
  const { loanApplicationId } = req.body;

  if (!loanApplicationId) {
    return sendError(res, 'Loan Application ID is required', 400);
  }

  try {
    const application = await agreementSigningService.generateAgreement(loanApplicationId, req.user._id);
    return sendSuccess(res, 'Loan agreement generated successfully', { application });
  } catch (error) {
    return sendError(res, error.message, 400);
  }
});

/**
 * @desc    Send OTP to Borrower
 * @route   POST /api/agreement/send-otp
 * @access  Private (Borrower/Staff/Admin)
 */
const sendOtp = asyncHandler(async (req, res) => {
  const { loanApplicationId } = req.body;

  if (!loanApplicationId) {
    return sendError(res, 'Loan Application ID is required', 400);
  }

  try {
    const result = await agreementSigningService.sendAgreementOTP(loanApplicationId, req.user);
    return sendSuccess(res, result.message, { expiresAt: result.expiresAt });
  } catch (error) {
    return sendError(res, error.message, 400);
  }
});

/**
 * @desc    Verify OTP and Sign Agreement
 * @route   POST /api/agreement/verify-otp
 * @access  Private (Borrower)
 */
const verifyOtp = asyncHandler(async (req, res) => {
  const { loanApplicationId, otpCode } = req.body;

  if (!loanApplicationId || !otpCode) {
    return sendError(res, 'Loan Application ID and OTP Code are required', 400);
  }

  try {
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    const application = await agreementSigningService.signAgreement(
      loanApplicationId,
      otpCode,
      clientIp,
      userAgent
    );
    return sendSuccess(res, 'Agreement signed successfully', { application });
  } catch (error) {
    return sendError(res, error.message, 400);
  }
});

/**
 * @desc    Get Agreement Status and History
 * @route   GET /api/agreement/status/:loanId
 * @access  Private (Borrower/Staff/Admin)
 */
const getAgreementStatus = asyncHandler(async (req, res) => {
  const { loanId } = req.params;

  if (!loanId) {
    return sendError(res, 'Loan ID parameter is required', 400);
  }

  try {
    let application = await LoanApplication.findById(loanId).lean();
    if (!application) {
      const ActiveLoan = require('../../../models/ActiveLoan');
      const activeLoan = await ActiveLoan.findById(loanId).lean();
      if (activeLoan && activeLoan.loanApplicationId) {
        application = await LoanApplication.findById(activeLoan.loanApplicationId).lean();
      }
    }

    if (!application) {
      return sendError(res, 'Loan application not found', 404);
    }

    // Fetch OTP requests history using the application's actual ID
    const otpHistory = await AgreementOTP.find({ loanApplicationId: application._id })
      .select('createdAt expiresAt verified attempts')
      .sort({ createdAt: -1 })
      .lean();

    return sendSuccess(res, 'Agreement status fetched successfully', {
      status: application.status,
      agreementGenerated: application.agreementGenerated || false,
      agreementGeneratedAt: application.agreementGeneratedAt || null,
      agreementSignedAt: application.agreementSignedAt || null,
      agreementStatus: application.agreementStatus || 'Not Generated',
      otpHistory,
    });
  } catch (error) {
    return sendError(res, error.message, 500);
  }
});

/**
 * @desc    Mark Signed Agreement Ready for Disbursement
 * @route   POST /api/agreement/ready-disbursement
 * @access  Private (Admin/Staff)
 */
const markReadyForDisbursement = asyncHandler(async (req, res) => {
  const { loanApplicationId } = req.body;

  if (!loanApplicationId) {
    return sendError(res, 'Loan Application ID is required', 400);
  }

  try {
    const application = await agreementSigningService.markReadyForDisbursement(loanApplicationId, req.user._id);
    return sendSuccess(res, 'Loan marked as ready for disbursement successfully', { application });
  } catch (error) {
    return sendError(res, error.message, 400);
  }
});

/**
 * @desc    Resend OTP to Borrower
 * @route   POST /api/agreement/resend-otp
 * @access  Private (Borrower/Staff/Admin)
 */
const resendOtp = asyncHandler(async (req, res) => {
  const { loanApplicationId } = req.body;

  if (!loanApplicationId) {
    return sendError(res, 'Loan Application ID is required', 400);
  }

  try {
    const result = await agreementSigningService.sendAgreementOTP(loanApplicationId, req.user);
    return sendSuccess(res, 'OTP signature code successfully resent.', { expiresAt: result.expiresAt });
  } catch (error) {
    return sendError(res, error.message, 400);
  }
});

/**
 * @desc    Get Agreement Document
 * @route   GET /api/agreement/document/:loanId
 * @access  Private (Borrower/Staff/Admin)
 */
const getAgreementDocument = asyncHandler(async (req, res) => {
  const { loanId } = req.params;

  if (!loanId) {
    return sendError(res, 'Loan ID parameter is required', 400);
  }

  try {
    let application = await LoanApplication.findById(loanId).lean();
    if (!application) {
      const ActiveLoan = require('../../../models/ActiveLoan');
      const activeLoan = await ActiveLoan.findById(loanId).lean();
      if (activeLoan && activeLoan.loanApplicationId) {
        application = await LoanApplication.findById(activeLoan.loanApplicationId).lean();
      }
    }

    if (!application) {
      return sendError(res, 'Loan application not found', 404);
    }

    const documentText = application.signedAgreement || `========================================================================
POINT.47 LOAN AGREEMENT & SIGNATURE RECEIPT
========================================================================
Application ID: ${application.applicationId}
Borrower Name: ${application.fullName}
Email Address: ${application.emailAddress}
Mobile Number: ${application.phoneNumber}
ID Number: ${application.idNumber}

LOAN PRINCIPAL DETAILS:
Approved Amount: R ${Number(application.requestedAmount || 0).toLocaleString()}
Duration: ${application.requestedDuration} Months
Estimated EMI: R ${Math.round(application.estimatedMonthlyEMI || 0).toLocaleString()}
Interest Rate: ${application.interestRate || '12'}% per annum

DIGITAL VERIFICATION & CONSENT RECORD:
Signing Method: Multi-Factor Secure OTP Consent
Consent Status: ${application.borrowerConsentVerified ? 'VERIFIED & COMPLETED' : 'PENDING BORROWER SIGNATURE'}
Agreement Status: ${application.agreementStatus || 'Not Generated'}
Generated At: ${application.agreementGeneratedAt ? new Date(application.agreementGeneratedAt).toLocaleString() : '—'}
Signed At: ${application.agreementSignedAt ? new Date(application.agreementSignedAt).toLocaleString() : '—'}

Thank you for choosing Point.47.
========================================================================`;

    res.setHeader('Content-Type', 'text/plain');
    return res.send(documentText);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
});

module.exports = {
  generateAgreement,
  sendOtp,
  verifyOtp,
  getAgreementStatus,
  markReadyForDisbursement,
  resendOtp,
  getAgreementDocument,
};
