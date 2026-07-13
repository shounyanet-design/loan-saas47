const express = require('express');
const router = express.Router();
const {
  getEarningsDashboard,
  getEarningsTable,
  getEarningDetails,
  exportEarnings,
  downloadStatement,
  getRecentPayouts
} = require('../../controllers/agent/earningsController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

// All routes are protected and restricted to agent
router.use(protect);
router.use(authorize('agent'));

router.get('/dashboard', getEarningsDashboard);
router.get('/', getEarningsTable);
router.get('/recent-payouts', getRecentPayouts);
router.get('/:commissionId', getEarningDetails);
router.post('/export', exportEarnings);
router.post('/statement', downloadStatement);

module.exports = router;
