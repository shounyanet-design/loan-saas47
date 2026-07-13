const express = require('express');
const router = express.Router();
const {
  getDashboardSummary,
  getAssignedClientsTable,
  sendPaymentReminder,
  createFollowupLog
} = require('../../controllers/agent/dashboardController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

// All routes are protected and restricted to agents
router.use(protect);
router.use(authorize('agent'));

router.get('/', getDashboardSummary);
router.get('/assigned-clients', getAssignedClientsTable);
router.post('/send-reminder', sendPaymentReminder);
router.post('/followup-log', createFollowupLog);

module.exports = router;
