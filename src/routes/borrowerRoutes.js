const express = require('express');
const router = express.Router();
const { 
  getMyLoans, 
  getEmiSchedule, 
  downloadStatement,
  getEligibilitySettings
} = require('../controllers/borrower/loanController');
const { 
  getPaymentDashboard, 
  submitPayment,
  getPaymentHistory,
  getReceiptDetails,
  downloadReceipt,
  exportPaymentHistory,
  downloadPaymentStatement
} = require('../controllers/borrower/paymentController');
const {
  getProfile,
  updateProfile,
  updateProfilePhoto,
  updatePassword
} = require('../controllers/borrower/profileController');
const { getBorrowerDashboard } = require('../controllers/borrower/dashboardController');
const { protect } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

// All routes are protected and for borrowers
router.use(protect);

router.get('/dashboard', getBorrowerDashboard);
router.get('/my-loans', getMyLoans);
router.get('/eligibility-settings', getEligibilitySettings);
router.get('/emi-schedule/:loanId', getEmiSchedule);
router.post('/download-loan-statement', downloadStatement);

// Payment routes
router.get('/payment-dashboard', getPaymentDashboard);
router.post('/submit-payment', upload.single('paymentProof'), submitPayment);
router.get('/payment-history', getPaymentHistory);
router.get('/payment-receipt/:paymentId', getReceiptDetails);
router.get('/download-receipt/:paymentId', downloadReceipt);
router.post('/export-payment-history', exportPaymentHistory);
router.post('/download-payment-statement', downloadPaymentStatement);

// Profile routes
router.get('/profile', getProfile);
router.put('/profile/update', updateProfile);
router.put('/profile/photo', upload.single('profilePhoto'), updateProfilePhoto);
router.put('/profile/change-password', updatePassword);

module.exports = router;
