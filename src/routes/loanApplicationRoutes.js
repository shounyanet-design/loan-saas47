const express = require('express');
const router = express.Router();
const {
  getAllApplications,
  getApplicationStats,
  getApplicationDetails,
  approveApplication,
  rejectApplication,
  holdApplication,
  updateStaffReview,
  assignReviewer,
  deleteApplication,
  createApplicationOnBehalf
} = require('../controllers/loanApplicationController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

// All routes here are for Admin
router.use(protect);
router.use(authorize('admin'));

router.get('/', getAllApplications);
router.get('/stats', getApplicationStats);
router.post('/create-on-behalf', createApplicationOnBehalf);
router.get('/:id', getApplicationDetails);
router.put('/:id/approve', approveApplication);
router.put('/:id/reject', rejectApplication);
router.put('/:id/hold', holdApplication);
router.put('/:id/review', updateStaffReview);
router.post('/assign-reviewer', assignReviewer);
router.delete('/:id', deleteApplication);

module.exports = router;
