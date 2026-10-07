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
  deleteReport,
  exportAgreementReportXlsx,
  exportInstallmentReportXlsx
} = require('../../controllers/admin/reportController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

router.use(protect);
router.use(authorize('admin'));

router.get('/stats', getReportStats);
router.get('/collections-overview', getCollectionsOverview);
router.get('/loan-performance', getLoanPerformance);
router.get('/borrower-overview', getBorrowerOverview);

// Specific report export endpoints (must be before /:id)
router.get('/agreement/export-xlsx', exportAgreementReportXlsx);
router.get('/installment/export-xlsx', exportInstallmentReportXlsx);

router.get('/', getAllReports);
router.post('/generate', generateReport);
router.get('/:id', getSingleReport);
router.post('/:id/export', exportReport);
router.delete('/:id', deleteReport);

module.exports = router;
