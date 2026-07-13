const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middlewares/superAdminMiddleware');
const plan = require('../controllers/planController');
const sub = require('../controllers/subscriptionController');
const cfg = require('../controllers/configController');

// NOTE: this sub-router is mounted INSIDE the platform router, AFTER its
// `protectPlatform` middleware — so every route here already runs as an
// authenticated SUPER_ADMIN in SYSTEM mode. (The public plan catalog lives in
// publicRoutes mounted at /api/public to avoid the platform auth guard.)

// Subscription plans
router.get('/plans', requirePermission('MANAGE_SUBSCRIPTION_PLANS'), plan.list);
router.post('/plans', requirePermission('MANAGE_SUBSCRIPTION_PLANS'), plan.create);
router.get('/plans/:id', requirePermission('MANAGE_SUBSCRIPTION_PLANS'), plan.getOne);
router.put('/plans/:id', requirePermission('MANAGE_SUBSCRIPTION_PLANS'), plan.update);
router.delete('/plans/:id', requirePermission('MANAGE_SUBSCRIPTION_PLANS'), plan.remove);

// Tenant subscriptions
router.get('/subscriptions', requirePermission('MANAGE_SUBSCRIPTION_PLANS'), sub.listAll);
router.get('/subscriptions/:tenantId', requirePermission('MANAGE_SUBSCRIPTION_PLANS'), sub.getForTenant);
router.post('/subscriptions/:tenantId', requirePermission('MANAGE_SUBSCRIPTION_PLANS'), sub.assign);
router.patch('/subscriptions/:tenantId/cancel', requirePermission('MANAGE_SUBSCRIPTION_PLANS'), sub.cancel);
router.patch('/subscriptions/:tenantId/resume', requirePermission('MANAGE_SUBSCRIPTION_PLANS'), sub.resume);
router.get('/subscriptions/:tenantId/history', requirePermission('MANAGE_SUBSCRIPTION_PLANS'), sub.history);

// Feature flags
router.get('/feature-catalog', requirePermission('MANAGE_FEATURE_FLAGS'), cfg.featureCatalog);
router.get('/tenants/:tenantId/features', requirePermission('MANAGE_FEATURE_FLAGS'), cfg.featureAvailability);
router.put('/tenants/:tenantId/features', requirePermission('MANAGE_FEATURE_FLAGS'), cfg.setFeatureOverride);
router.delete('/tenants/:tenantId/features', requirePermission('MANAGE_FEATURE_FLAGS'), cfg.resetFeatureOverrides);

// Usage dashboard
router.get('/usage', requirePermission('VIEW_ANALYTICS'), cfg.getPlatformUsage);
router.get('/usage/:tenantId', requirePermission('VIEW_ANALYTICS'), cfg.getUsage);

// Tenant branding (platform-managed)
router.get('/tenants/:tenantId/branding', requirePermission('MANAGE_TENANTS'), cfg.getBranding);
router.put('/tenants/:tenantId/branding', requirePermission('MANAGE_TENANTS'), cfg.updateBranding);

// Tenant API settings (platform-managed) — secrets always masked
router.get('/tenants/:tenantId/api-settings', requirePermission('MANAGE_TENANTS'), cfg.getApiSettings);
router.put('/tenants/:tenantId/api-settings/:provider', requirePermission('MANAGE_TENANTS'), cfg.updateProvider);
router.post('/tenants/:tenantId/api-settings/:provider/test', requirePermission('MANAGE_TENANTS'), cfg.testProvider);

// License management
router.get('/tenants/:tenantId/license', requirePermission('MANAGE_TENANTS'), cfg.getLicense);

module.exports = router;
