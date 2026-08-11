const express = require('express');
const router = express.Router();
const { handleRealPayWebhook } = require('../controllers/realpayWebhookController');

// Public Webhook Endpoint for RealPay callbacks
router.post('/webhook', handleRealPayWebhook);

module.exports = router;
