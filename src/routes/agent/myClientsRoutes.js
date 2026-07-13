const express = require('express');
const router = express.Router();
const {
  getClientDashboard,
  getClients,
  getBorrowerDetails,
  saveAssistance,
  saveFollowUp,
  getRecentActivities
} = require('../../controllers/agent/myClientsController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

// All routes are protected and restricted to agent
router.use(protect);
router.use(authorize('agent'));

router.get('/dashboard', getClientDashboard);
router.get('/', getClients);
router.get('/activities', getRecentActivities);
router.get('/:borrowerId', getBorrowerDetails);
router.post('/assistance', saveAssistance);
router.post('/follow-up', saveFollowUp);

module.exports = router;
