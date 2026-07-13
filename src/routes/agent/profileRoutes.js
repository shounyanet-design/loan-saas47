const express = require('express');
const {
  getAgentProfile,
  updateAgentProfile,
  uploadAgentProfilePhoto,
  changeAgentPassword,
  getProfileActivity
} = require('../../controllers/agent/profileController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const upload = require('../../middlewares/uploadMiddleware');

const router = express.Router();

// Apply auth middleware for all routes
router.use(protect);
router.use(authorize('agent'));

// Profile Information routes
router.route('/')
  .get(getAgentProfile)
  .put(updateAgentProfile);

// Image Upload route (PATCH /api/agent/profile/image)
router.route('/image')
  .patch(upload.single('profileImage'), uploadAgentProfilePhoto);

// Password route (PATCH /api/agent/profile/password)
router.route('/password')
  .patch(changeAgentPassword);

// Activity route (GET /api/agent/profile/activity)
router.route('/activity')
  .get(getProfileActivity);

module.exports = router;
