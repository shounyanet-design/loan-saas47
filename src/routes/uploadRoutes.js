const express = require('express');
const router = express.Router();
const upload = require('../middlewares/uploadMiddleware');
const imagekit = require('../config/imagekit');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middlewares/authMiddleware');

// @desc    Upload single file to ImageKit
// @route   POST /api/upload
// @access  Private
router.post(
  '/',
  protect,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return sendError(res, 'Please upload a file', 400);
    }

    const result = await imagekit.upload({
      file: req.file.buffer, // Buffer from multer
      fileName: `${Date.now()}-${req.file.originalname}`,
      folder: '/lms-uploads',
    });

    sendSuccess(res, 'File uploaded successfully', {
      url: result.url,
      fileId: result.fileId,
      name: result.name,
    });
  })
);

module.exports = router;
