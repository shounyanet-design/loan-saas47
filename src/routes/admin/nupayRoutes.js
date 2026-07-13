const express = require('express');
const router = express.Router();
const {
  initiateDebiCheckMandate,
  rescheduleNuPayInstalment,
  maintainNuPayInstalment,
  cancelNuPayInstalment,
  recallNuPayInstalment
} = require('../../controllers/admin/nupayController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

router.use(protect);
router.use(authorize('admin'));

router.post('/mandate-initiation', initiateDebiCheckMandate);
router.post('/instalment-reschedule', rescheduleNuPayInstalment);
router.post('/instalment-maintenance', maintainNuPayInstalment);
router.post('/instalment-cancellation', cancelNuPayInstalment);
router.post('/instalment-recall', recallNuPayInstalment);

module.exports = router;
