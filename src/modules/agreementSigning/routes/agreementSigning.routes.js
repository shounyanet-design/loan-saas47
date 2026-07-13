const express = require('express');
const router = express.Router();
const { protect } = require('../../../middlewares/authMiddleware');
const { authorize } = require('../../../middlewares/roleMiddleware');
const { validateAgreementAccess } = require('../middleware/agreementValidation.middleware');
const {
  generateAgreement,
  sendOtp,
  verifyOtp,
  getAgreementStatus,
  markReadyForDisbursement,
  resendOtp,
  getAgreementDocument,
} = require('../controllers/agreementSigning.controller');

// All routes require authentication
router.use(protect);

// Generate Agreement - Admin & Staff only
router.post('/generate', authorize('admin', 'staff'), validateAgreementAccess, generateAgreement);

// Send OTP - Borrower, Staff, Admin (Staff/Admin can send or resend to borrower)
router.post('/send-otp', validateAgreementAccess, sendOtp);

// Resend OTP - Borrower, Staff, Admin
router.post('/resend-otp', validateAgreementAccess, resendOtp);

// Verify OTP - Borrower only (Since they are the ones signing)
router.post('/verify-otp', authorize('borrower'), validateAgreementAccess, verifyOtp);

// Get Status & History - Borrower, Staff, Admin
router.get('/status/:loanId', validateAgreementAccess, getAgreementStatus);

// Get Agreement Document - Borrower, Staff, Admin
router.get('/document/:loanId', validateAgreementAccess, getAgreementDocument);

// Mark Ready For Disbursement - Admin & Staff only
router.post('/ready-disbursement', authorize('admin', 'staff'), validateAgreementAccess, markReadyForDisbursement);

module.exports = router;
