const express = require('express');
const router = express.Router();
const { getValidationRules } = require('../services/validationRules.service');
const { protect } = require('../middlewares/authMiddleware');
const { sendSuccess } = require('../utils/responseHandler');
const asyncHandler = require('../utils/asyncHandler');

// Fetch the active validation rules. Protected to logged in users of any role.
router.get('/', protect, asyncHandler(async (req, res) => {
  const rules = await getValidationRules();
  sendSuccess(res, 'Validation rules fetched successfully', rules);
}));

module.exports = router;
