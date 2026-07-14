const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../middlewares/superAdminMiddleware');
const c = require('../controllers/platformOpsController');

// Mounted inside the platform router (already SUPER_ADMIN + SYSTEM mode).
// Reuses existing permissions; VIEW_ANALYTICS gates read-only ops dashboards.

router.get('/monitoring', requirePermission('VIEW_ANALYTICS'), c.monitoring);
router.get('/queues', requirePermission('VIEW_ANALYTICS'), c.queueStats);
router.get('/queues/dead-letters', requirePermission('VIEW_ANALYTICS'), c.deadLetters);
router.post('/queues/dead-letters/:jobId/retry', requirePermission('MANAGE_GLOBAL_SETTINGS'), c.retryDead);
router.get('/logs', requirePermission('MANAGE_AUDIT_LOGS'), c.logs);
router.get('/backups', requirePermission('MANAGE_GLOBAL_SETTINGS'), c.listBackups);
router.post('/backups', requirePermission('MANAGE_GLOBAL_SETTINGS'), c.createBackup);
router.post('/backups/:id/verify', requirePermission('MANAGE_GLOBAL_SETTINGS'), c.verifyBackup);
router.post('/backups/:id/restore', requirePermission('MANAGE_GLOBAL_SETTINGS'), c.restoreBackup);
router.get('/domains', requirePermission('MANAGE_TENANTS'), c.listAllDomains);
router.get('/domains/analytics', requirePermission('MANAGE_TENANTS'), c.domainAnalytics);
router.post('/domains/:id/force-verify', requirePermission('MANAGE_TENANTS'), c.forceVerifyDomain);

module.exports = router;
