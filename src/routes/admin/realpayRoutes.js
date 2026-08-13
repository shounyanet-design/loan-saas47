const express = require('express');
const router = express.Router();
const {
  simulateMandateEndpoint,
  simulateInstalmentEndpoint
} = require('../../controllers/admin/realpaySimulationController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

router.use(protect);
router.use(authorize('admin', 'super_admin'));

router.post('/simulate/mandate', simulateMandateEndpoint);
router.post('/simulate/instalment', simulateInstalmentEndpoint);

module.exports = router;
