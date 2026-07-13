const express = require('express');
const router = express.Router();
const { 
  getLoanRepaymentSchedule, 
  getUpcomingEMIs, 
  updateRepayment,
  waivePenalty,
  markDispute
} = require('../controllers/repaymentController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

router.get('/loan/:loanId', protect, getLoanRepaymentSchedule);
router.get('/upcoming', protect, getUpcomingEMIs);
router.put('/:id', protect, authorize('admin'), updateRepayment);
router.post('/:id/waive-penalty', protect, authorize('admin'), waivePenalty);
router.post('/:id/dispute', protect, authorize('admin'), markDispute);

module.exports = router;
