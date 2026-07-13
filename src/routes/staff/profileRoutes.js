const express = require('express');
const router = express.Router();
const {
  getStaffProfile,
  updateStaffProfile,
  changeStaffPassword,
  uploadStaffProfilePhoto
} = require('../../controllers/staff/profileController');
const { protect } = require('../../middlewares/authMiddleware');
const upload = require('../../middlewares/uploadMiddleware');

// Protect all routes
router.use(protect);

router.get('/', getStaffProfile);
router.put('/update', updateStaffProfile);
router.put('/change-password', changeStaffPassword);
router.put('/upload-photo', upload.single('profilePhoto'), uploadStaffProfilePhoto);

module.exports = router;
