const express = require('express');
const router = express.Router();

const { protect } = require('../../../middlewares/authMiddleware');
const { authorize } = require('../../../middlewares/roleMiddleware');
const validateSubscription = require('../../../middlewares/validateSubscription');
const sub = require('../controllers/subscriptionController');
const cfg = require('../controllers/configController');

// Tenant self-service SaaS pages. Tenant admin only. Runs inside the tenant
// context (established by `protect`). validateSubscription guards account state
// but is permissive for grandfathered/active tenants (never blocks the LMS).
router.use(protect, authorize('admin'), validateSubscription());

// Subscription
router.get('/subscription', sub.mySubscription);
router.patch('/subscription/auto-renew', sub.setAutoRenew);

// Usage
router.get('/usage', cfg.getUsage);

// Feature availability
router.get('/feature-availability', cfg.featureAvailability);

// License
router.get('/license', cfg.getLicense);

// Branding (self-service)
router.get('/branding', cfg.getBranding);
router.put('/branding', cfg.updateBranding);

// API credentials (self-service) — secrets masked on read
router.get('/api-credentials', cfg.getApiSettings);
router.put('/api-credentials/:provider', cfg.updateProvider);
router.post('/api-credentials/:provider/test', cfg.testProvider);

module.exports = router;
