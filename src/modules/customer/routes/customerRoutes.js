const express = require('express');
const router = express.Router();
const { protect } = require('../../../middlewares/authMiddleware');
const { authorize } = require('../../../middlewares/roleMiddleware');
const validateSubscription = require('../../../middlewares/validateSubscription');
const c = require('../controllers/customerController');

// Customer portal (tenant admin). Distinct prefix /api/customer.
router.use(protect, authorize('admin'), validateSubscription());

// Support
router.get('/support/tickets', c.listTickets);
router.post('/support/tickets', c.createTicket);
router.get('/support/tickets/:id', c.getTicket);
router.post('/support/tickets/:id/reply', c.replyTicket);
router.patch('/support/tickets/:id/close', c.closeTicket);

// API keys (developer portal)
router.get('/api-keys', c.listKeys);
router.post('/api-keys', c.createKey);
router.delete('/api-keys/:id', c.revokeKey);

// Profile
router.get('/profile', c.profile);

module.exports = router;
