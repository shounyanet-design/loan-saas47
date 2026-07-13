const express = require('express');
const router = express.Router();
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const {
  getPaymentVerificationOverview,
  getPaymentVerifications,
  getPaymentVerificationById,
  verifyPayment,
  rejectPayment,
  getVerificationHistory,
  manualRecordPayment,
  markFieldVisit
} = require('../../controllers/staff/paymentVerificationController');

// Secure endpoint access exclusively to authenticated Staff
router.use(protect);
router.use(authorize('staff'));

router.get('/overview', getPaymentVerificationOverview);
router.get('/history', getVerificationHistory);
router.get('/', getPaymentVerifications);
router.get('/:id', getPaymentVerificationById);
router.put('/:id/verify', verifyPayment);
router.put('/:id/reject', rejectPayment);
router.post('/manual', manualRecordPayment);
router.post('/field-visit', markFieldVisit);

module.exports = router;
