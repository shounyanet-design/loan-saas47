const express = require('express');
const router = express.Router();
const {
  getReportStats,
  getCollectionsOverview,
  getLoanPerformance,
  getBorrowerOverview,
  getAllReports,
  getSingleReport,
  generateReport,
  exportReport,
  deleteReport
} = require('../../controllers/admin/reportController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

router.use(protect);
router.use(authorize('admin'));

router.get('/stats', getReportStats);
router.get('/collections-overview', getCollectionsOverview);
router.get('/loan-performance', getLoanPerformance);
router.get('/borrower-overview', getBorrowerOverview);

router.get('/', getAllReports);
router.post('/generate', generateReport);
router.get('/:id', getSingleReport);
router.post('/:id/export', exportReport);
router.delete('/:id', deleteReport);

module.exports = router;
