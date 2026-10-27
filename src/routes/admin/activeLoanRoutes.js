const express = require('express');
const router = express.Router();
const {
  getAllActiveLoans,
  getDashboardStats,
  getOverdueLoans,
  getCompletedLoans,
  exportLoanData,
  getDuePayments,
  getLoanDetails,
  updateLoanStatus,
  addAdminNotes,
  closeLoan,
  deleteLoan,
  assignAgent,
  getSettlementQuote,
  settleLoan,
  updateCollectionStatus,
  syncDebi24CollectionStatus,
  syncAllDebi24Collections,
  maintainLoanCollection
} = require('../../controllers/admin/activeLoanController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

// All routes are protected and admin-only
router.use(protect);
router.use(authorize('admin'));

// Stats, Export, and Batch Sync (must be before /:id)
router.get('/stats', getDashboardStats);
router.get('/export', exportLoanData);
router.get('/overdue', getOverdueLoans);
router.get('/completed', getCompletedLoans);
router.get('/due-payments', getDuePayments);
router.post('/sync-all-debi24', syncAllDebi24Collections);

// Core CRUD
router.get('/', getAllActiveLoans);
router.get('/:id', getLoanDetails);
router.get('/:id/settlement-quote', getSettlementQuote);
router.post('/:id/settle', settleLoan);
router.delete('/:id', deleteLoan);

// Status, Notes, Closure, and Collections
router.put('/:id/status', updateLoanStatus);
router.put('/:id/collection-status', updateCollectionStatus);
router.post('/:id/sync-debi24', syncDebi24CollectionStatus);
router.post('/:id/maintain-collection', maintainLoanCollection);
router.put('/:id/notes', addAdminNotes);
router.put('/:id/close', closeLoan);

// Agent Assignment
router.post('/assign-agent', assignAgent);

module.exports = router;

