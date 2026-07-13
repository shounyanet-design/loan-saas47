const express = require('express');
const router = express.Router();
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const {
  getDashboardOverview,
  getFinancialPerformance,
  getOperationalStatus,
  getRecentApplications,
  getSystemAlerts,
  getRecentPayments,
  getSystemHealth,
  getRealtimeData
} = require('../../controllers/admin/dashboardController');

// Apply standard Admin restriction barriers
router.use(protect);
router.use(authorize('admin'));

router.get('/overview', getDashboardOverview);
router.get('/financial-performance', getFinancialPerformance);
router.get('/operational-status', getOperationalStatus);
router.get('/recent-applications', getRecentApplications);
router.get('/system-alerts', getSystemAlerts);
router.get('/recent-payments', getRecentPayments);
router.get('/system-health', getSystemHealth);
router.get('/realtime', getRealtimeData);

module.exports = router;
