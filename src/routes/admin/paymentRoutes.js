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
  downloadReceipt,
  reversePayment,
  syncPaymentSettlement,
  syncAllPaymentSettlementsRoute
} = require('../../controllers/admin/paymentController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

// All routes are protected and admin-only
router.use(protect);
router.use(authorize('admin'));

// Stats, Export & Batch Sync (must be before /:id)
router.get('/stats', getPaymentStats);
router.get('/export', exportPayments);
router.post('/sync-all-settlements', syncAllPaymentSettlementsRoute);

// Status-specific lists
router.get('/pending', getPendingPayments);
router.get('/verified', getVerifiedPayments);
router.get('/rejected', getRejectedPayments);

// Core operations
router.get('/', getAllPayments);
router.get('/:id', getPaymentDetails);
router.post('/:id/sync-settlement', syncPaymentSettlement);
router.put('/:id/verify', verifyPayment);
router.put('/:id/reject', rejectPayment);
router.put('/:id/reverse', reversePayment);
router.get('/:id/receipt', downloadReceipt);

module.exports = router;
