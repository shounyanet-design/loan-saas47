const express = require('express');
const router = express.Router();
const {
  createStaff,
  getAllStaff,
  getStaff,
  updateStaff,
  changePermissions,
  activateStaff,
  markInactive,
  suspendStaff,
  deleteStaff,
  getReviewers
} = require('../controllers/staffController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const upload = require('../middlewares/uploadMiddleware');
const { enforceLimit } = require('../modules/saas/services/limitService');

// Protect all routes - Admin only
router.use(protect);
router.use(authorize('admin'));

// enforceLimit blocks creation once the tenant's plan "Max Staff" is reached
// (no-op for grandfathered/unlimited plans).
router.post('/create', enforceLimit('staff'), upload.single('profilePhoto'), createStaff);
router.get('/reviewers', getReviewers);
router.get('/', getAllStaff);
router.get('/:id', getStaff);
router.put('/:id', upload.single('profilePhoto'), updateStaff);
router.put('/:id/permissions', changePermissions);
router.put('/:id/activate', activateStaff);
router.put('/:id/inactive', markInactive);
router.put('/:id/suspend', suspendStaff);
router.delete('/:id', deleteStaff);

module.exports = router;
