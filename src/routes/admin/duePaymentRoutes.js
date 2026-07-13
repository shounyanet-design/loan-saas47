const express = require('express');
const router = express.Router();
const {
  getAllDuePayments,
  getDuePaymentStats,
  getDuePaymentDetails,
  getDueTodayPayments,
  getOverduePayments,
  sendReminder,
  sendBulkReminders,
  exportDuePayments,
  updateNotes
} = require('../../controllers/admin/duePaymentController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

router.use(protect);
router.use(authorize('admin'));

router.get('/stats', getDuePaymentStats);
router.get('/export', exportDuePayments);
router.post('/bulk-reminders', sendBulkReminders);

router.get('/today', getDueTodayPayments);
router.get('/overdue', getOverduePayments);

router.get('/', getAllDuePayments);
router.get('/:id', getDuePaymentDetails);
router.post('/:id/send-reminder', sendReminder);
router.put('/:id/notes', updateNotes);

module.exports = router;
