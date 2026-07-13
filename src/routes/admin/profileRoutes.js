const express = require('express');
const router = express.Router();
const {
  getAdminProfile,
  updateAdminProfile,
  updateProfilePhoto,
  changePassword,
  verifyCurrentPassword
} = require('../../controllers/admin/profileController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const upload = require('../../middlewares/uploadMiddleware');

// Apply global protection middleware to these routes
router.use(protect);
router.use(authorize('admin'));

router.get('/', getAdminProfile);
router.put('/update', updateAdminProfile);
router.put('/photo', upload.single('profilePhoto'), updateProfilePhoto);
router.put('/change-password', changePassword);
router.post('/verify-password', verifyCurrentPassword);

module.exports = router;
