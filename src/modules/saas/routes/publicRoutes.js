const express = require('express');
const router = express.Router();
const plan = require('../controllers/planController');

// Public, unauthenticated SaaS endpoints (pricing page / onboarding).
router.get('/plans', plan.listPublic);

module.exports = router;
