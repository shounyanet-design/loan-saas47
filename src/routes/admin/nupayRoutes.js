const express = require('express');
const router = express.Router();
const {
  initiateDebiCheckMandate,
  registerTT1Endpoint,
  getMandateReport,
  getInstalmentReport
} = require('../../controllers/admin/nupayController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

router.use(protect);
router.use(authorize('admin', 'super_admin'));

router.post('/mandates/initiate', initiateDebiCheckMandate);
router.post('/tt1/register-endpoint', registerTT1Endpoint);
router.post('/reports/mandates', getMandateReport);
router.post('/reports/instalments', getInstalmentReport);

module.exports = router;
