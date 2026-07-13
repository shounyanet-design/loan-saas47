const express = require('express');
const router = express.Router();
const { sendSuccess } = require('../utils/responseHandler');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

// @desc    Test Admin route
// @route   GET /api/admin/test
// @access  Private/Admin
router.get('/test', protect, authorize('admin'), (req, res) => {
  sendSuccess(res, 'Admin route is working and you are authorized');
});

module.exports = router;
