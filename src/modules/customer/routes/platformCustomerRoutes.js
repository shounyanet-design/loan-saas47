const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../middlewares/superAdminMiddleware');
const c = require('../controllers/platformCustomerController');

// Mounted inside the platform router (already SUPER_ADMIN + SYSTEM mode).

// Knowledge base management
router.get('/knowledge', requirePermission('MANAGE_GLOBAL_SETTINGS'), c.kbList);
router.post('/knowledge', requirePermission('MANAGE_GLOBAL_SETTINGS'), c.kbCreate);
router.put('/knowledge/:id', requirePermission('MANAGE_GLOBAL_SETTINGS'), c.kbUpdate);
router.delete('/knowledge/:id', requirePermission('MANAGE_GLOBAL_SETTINGS'), c.kbDelete);

// Announcements
router.get('/announcements', requirePermission('MANAGE_NOTIFICATIONS'), c.annList);
router.post('/announcements', requirePermission('MANAGE_NOTIFICATIONS'), c.annCreate);
router.put('/announcements/:id', requirePermission('MANAGE_NOTIFICATIONS'), c.annUpdate);

// Support triage
router.get('/support/tickets', requirePermission('MANAGE_SUPPORT_TICKETS'), c.ticketsAll);
router.post('/support/tickets/:id/reply', requirePermission('MANAGE_SUPPORT_TICKETS'), c.ticketReply);

module.exports = router;
