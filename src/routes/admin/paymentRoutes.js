const express = require('express');
const router = express.Router();
const {
  getAllPayments,
  getPaymentStats,
  getPaymentDetails,
  verifyPayment,
  rejectPayment,
  getPendingPayments,
  getVerifiedPayments,
  getRejectedPayments,
  exportPayments,
  downloadReceipt
} = require('../../controllers/admin/paymentController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

// All routes are protected and admin-only
router.use(protect);
router.use(authorize('admin'));

// Stats & Export (must be before /:id)
router.get('/stats', getPaymentStats);
router.get('/export', exportPayments);

// Status-specific lists
router.get('/pending', getPendingPayments);
router.get('/verified', getVerifiedPayments);
router.get('/rejected', getRejectedPayments);

// Core operations
router.get('/', getAllPayments);
router.get('/:id', getPaymentDetails);
router.put('/:id/verify', verifyPayment);
router.put('/:id/reject', rejectPayment);
router.get('/:id/receipt', downloadReceipt);

module.exports = router;
