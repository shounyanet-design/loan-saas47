const express = require('express');
const router = express.Router();
const payfastController = require('../controllers/payfastWebhookController');
const { protect } = require('../../../middlewares/authMiddleware');

// Public ITN Webhook endpoint (Payfast posts directly to this route)
router.post('/notify', payfastController.handlePayfastNotify);
router.post('/itn', payfastController.handlePayfastNotify);

// Tenant-scoped transaction status query
router.get('/status/:mPaymentId', protect, payfastController.getPaymentStatus);

module.exports = router;
