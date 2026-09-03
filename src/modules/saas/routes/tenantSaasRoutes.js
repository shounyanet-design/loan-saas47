const express = require('express');
const router = express.Router();

const { protect } = require('../../../middlewares/authMiddleware');
const { authorize } = require('../../../middlewares/roleMiddleware');
const validateSubscription = require('../../../middlewares/validateSubscription');
const sub = require('../controllers/subscriptionController');
const cfg = require('../controllers/configController');

// Tenant self-service SaaS pages. Tenant admin only. Runs inside the tenant
// context (established by `protect`).
router.use(protect, authorize('admin'));

// Subscription
router.get('/subscription', sub.mySubscription);
router.patch('/subscription/auto-renew', sub.setAutoRenew);
router.post('/subscription/checkout', sub.checkoutSubscription);

// Usage
router.get('/usage', cfg.getUsage);

// Feature availability
router.get('/feature-availability', cfg.featureAvailability);

// License
router.get('/license', cfg.getLicense);

// Branding (self-service)
router.get('/branding', cfg.getBranding);
router.put('/branding', cfg.updateBranding);

// Unified SaaS Context (Consolidated metadata for Tenant Admin)
router.get('/saas-context', cfg.getSaasContext);

// API credentials (self-service) — secrets masked on read
router.get('/api-credentials', cfg.getApiSettings);
router.put('/api-credentials/:provider', cfg.updateProvider);
router.post('/api-credentials/:provider/test', cfg.testProvider);

module.exports = router;
