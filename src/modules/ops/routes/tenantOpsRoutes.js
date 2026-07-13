const express = require('express');
const router = express.Router();
const { protect } = require('../../../middlewares/authMiddleware');
const { authorize } = require('../../../middlewares/roleMiddleware');
const validateSubscription = require('../../../middlewares/validateSubscription');
const c = require('../controllers/tenantOpsController');

// Tenant self-service ops. Distinct prefix (/api/ops) to avoid overlap with
// /api/tenant. Tenant context via `protect`.
router.use(protect, authorize('admin'), validateSubscription());

router.get('/domains', c.listDomains);
router.post('/domains', c.addDomain);
router.post('/domains/:id/verify', c.verifyDomain);
router.delete('/domains/:id', c.removeDomain);
router.get('/system-status', c.systemStatus);
router.get('/backup-status', c.backupStatus);

module.exports = router;
