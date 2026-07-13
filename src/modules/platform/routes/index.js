const express = require('express');
const router = express.Router();

const { protectPlatform, requirePermission } = require('../../../middlewares/superAdminMiddleware');
const auth = require('../controllers/authController');
const dashboard = require('../controllers/dashboardController');
const tenants = require('../controllers/tenantController');
const settings = require('../controllers/settingsController');
const audit = require('../controllers/auditController');
const notifications = require('../controllers/notificationController');
const platformUsers = require('../controllers/platformUserController');
const leads = require('../controllers/leadController');

// ---- Public ----
router.post('/auth/login', auth.login);

// ---- Everything below requires an authenticated SUPER_ADMIN ----
router.use(protectPlatform);

// Auth / profile
router.get('/auth/me', auth.getMe);
router.put('/auth/change-password', auth.changePassword);
router.put('/auth/profile', auth.updateProfile);

// Dashboard & analytics
router.get('/dashboard', requirePermission('VIEW_ANALYTICS'), dashboard.getDashboard);
router.get('/analytics', requirePermission('VIEW_ANALYTICS'), dashboard.getAnalytics);

// Tenant management
router.get('/tenants', requirePermission('MANAGE_TENANTS'), tenants.list);
router.post('/tenants', requirePermission('MANAGE_TENANTS'), tenants.create);
router.get('/tenants/:id', requirePermission('MANAGE_TENANTS'), tenants.getOne);
router.put('/tenants/:id', requirePermission('MANAGE_TENANTS'), tenants.update);
router.patch('/tenants/:id/suspend', requirePermission('MANAGE_TENANTS'), tenants.suspend);
router.patch('/tenants/:id/activate', requirePermission('MANAGE_TENANTS'), tenants.activate);
router.delete('/tenants/:id', requirePermission('MANAGE_TENANTS'), tenants.remove);

// Leads (tenant onboarding / signup pipeline)
router.get('/leads/stats', requirePermission('MANAGE_TENANTS'), leads.stats);
router.get('/leads', requirePermission('MANAGE_TENANTS'), leads.list);

// Global settings
router.get('/settings', requirePermission('MANAGE_GLOBAL_SETTINGS'), settings.get);
router.put('/settings', requirePermission('MANAGE_GLOBAL_SETTINGS'), settings.update);

// Audit logs
router.get('/audit-logs', requirePermission('MANAGE_AUDIT_LOGS'), audit.list);

// Notifications (any platform user may read their own; creating broadcasts needs the permission)
router.get('/notifications', notifications.list);
router.get('/notifications/unread-count', notifications.unreadCount);
router.patch('/notifications/read-all', notifications.markAllRead);
router.patch('/notifications/:id/read', notifications.markRead);
router.post('/notifications', requirePermission('MANAGE_NOTIFICATIONS'), notifications.create);

// Platform users
router.get('/platform-users', requirePermission('MANAGE_PLATFORM_USERS'), platformUsers.list);
router.post('/platform-users', requirePermission('MANAGE_PLATFORM_USERS'), platformUsers.create);
router.patch('/platform-users/:id/status', requirePermission('MANAGE_PLATFORM_USERS'), platformUsers.setActive);

// Milestone 2.2 SaaS core (plans, subscriptions, usage, branding, api settings,
// feature flags, license). Mounted here so it inherits protectPlatform above.
router.use(require('../../saas/routes/platformSaasRoutes'));

// Milestone 2.3 SaaS commerce (pricing, marketplace, wallet, orders, invoices,
// payments, analytics). Also inherits protectPlatform.
router.use(require('../../commerce/routes/platformCommerceRoutes'));

// Milestone 2.4 enterprise ops (monitoring, queues, logs, backups, domains).
router.use(require('../../ops/routes/platformOpsRoutes'));

// Milestone 2.5 commercial (knowledge base, announcements, support triage).
router.use(require('../../customer/routes/platformCustomerRoutes'));

module.exports = router;
