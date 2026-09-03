const express = require('express');
const router = express.Router();
const {
  initiateRealPayMandate,
  simulateMandateEndpoint,
  simulateInstalmentEndpoint
} = require('../../controllers/admin/realpayAdminController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

router.use(protect);
router.use(authorize('admin', 'super_admin'));

router.post('/mandates/initiate', initiateRealPayMandate);
router.post('/simulate/mandate', simulateMandateEndpoint);
router.post('/simulate/instalment', simulateInstalmentEndpoint);

module.exports = router;
