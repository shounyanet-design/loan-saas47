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
router.get('/domains/availability', c.checkAvailability);
router.post('/domains', c.addDomain);
router.post('/domains/:id/verify', c.verifyDomain);
router.post('/domains/:id/set-primary', c.setPrimaryDomain);
router.patch('/domains/:id/settings', c.updateDomainSettings);
router.post('/domains/:id/refresh-dns', c.refreshDns);
router.delete('/domains/:id', c.removeDomain);
router.get('/system-status', c.systemStatus);
router.get('/backup-status', c.backupStatus);

module.exports = router;
