const express = require('express');
const router = express.Router();
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const {
  getLoanReviewOverview,
  getLoanReviews,
  getLoanReviewById,
  recommendApproval,
  recommendRejection,
  requestDocuments,
  getReviewHistory
} = require('../../controllers/staff/loanReviewController');

// Apply blanket Auth & Permission guards
router.use(protect);
router.use(authorize('staff'));

// Core Paths
router.get('/overview', getLoanReviewOverview);
router.get('/history', getReviewHistory);
router.get('/', getLoanReviews);
router.get('/:id', getLoanReviewById);

// Form Actions
router.put('/:id/recommend-approval', recommendApproval);
router.put('/:id/recommend-rejection', recommendRejection);
router.put('/:id/request-documents', requestDocuments);

module.exports = router;
