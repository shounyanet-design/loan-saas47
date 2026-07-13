const express = require('express');
const router = express.Router();
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const {
  getLoanRequestOverview,
  getLoanRequests,
  getLoanRequestById,
  verifyDocuments,
  submitReview,
  getReviewHistory
} = require('../../controllers/staff/loanRequestController');
const { createApplicationOnBehalf } = require('../../controllers/loanApplicationController');

// Secure endpoint access exclusively to authenticated Staff
router.use(protect);
router.use(authorize('staff'));

router.get('/overview', getLoanRequestOverview);
router.get('/review-history', getReviewHistory);
router.post('/create-on-behalf', createApplicationOnBehalf);
router.get('/', getLoanRequests);
router.get('/:id', getLoanRequestById);
router.put('/:id/verify-documents', verifyDocuments);
router.put('/:id/review', submitReview);

module.exports = router;
