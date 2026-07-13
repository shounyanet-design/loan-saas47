const express = require('express');
const router = express.Router();
const c = require('../controllers/onboardingController');
const { bruteForceGuard } = require('../../../middlewares/securityMiddleware');

// Public, unauthenticated onboarding wizard. Rate-limited per IP.
router.post('/start', bruteForceGuard({ max: 20 }), c.start);
router.post('/verify-email', c.verifyEmail);
router.post('/select-plan', c.selectPlan);
router.post('/provision', c.provision);
router.get('/:sessionId/status', c.status);

module.exports = router;
