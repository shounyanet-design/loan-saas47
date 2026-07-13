const express = require('express');
const router = express.Router();
const Agent = require('../models/Agent');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

// @desc    Get current agent profile
// @route   GET /api/agent/profile
// @access  Private/Agent
router.get('/profile', protect, authorize('agent'), asyncHandler(async (req, res) => {
  const agent = await Agent.findOne({ userId: req.user._id });
  
  if (!agent) {
    return sendError(res, 'Agent profile not found', 404);
  }

  sendSuccess(res, 'Agent profile retrieved', agent);
}));

// @desc    Test Agent route
// @route   GET /api/agent/test
// @access  Private/Agent
router.get('/test', protect, authorize('agent'), (req, res) => {
  sendSuccess(res, 'Agent route is working');
});

module.exports = router;
