const User = require('../../models/User');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const imagekit = require('../../config/imagekit');
const bcrypt = require('bcryptjs');

/**
 * @desc    Get logged-in Admin profile
 * @route   GET /api/admin/profile
 * @access  Private/Admin
 */
const getAdminProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('-password');
  if (!user) {
    return sendError(res, 'Administrator session not found', 404);
  }
  sendSuccess(res, 'Profile loaded successfully', user);
});

/**
 * @desc    Update Admin personal profile information
 * @route   PUT /api/admin/profile/update
 * @access  Private/Admin
 */
const updateAdminProfile = asyncHandler(async (req, res) => {
  const { fullName, phoneNumber, dateOfBirth, address, primaryBranch } = req.body;
  
  const updateData = {};
  if (fullName !== undefined) updateData.fullName = fullName;
  if (phoneNumber !== undefined) updateData.phone = phoneNumber; // Sync legacy 'phone'
  if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
  if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth;
  if (address !== undefined) updateData.address = address;
  if (primaryBranch !== undefined) updateData.primaryBranch = primaryBranch;

  const updatedUser = await User.findByIdAndUpdate(
    req.user._id,
    { $set: updateData },
    { new: true, runValidators: true }
  ).select('-password');

  if (!updatedUser) {
    return sendError(res, 'Could not locate admin record', 404);
  }

  sendSuccess(res, 'Profile updated successfully', updatedUser);
});

/**
 * @desc    Update profile photo using ImageKit
 * @route   PUT /api/admin/profile/photo
 * @access  Private/Admin
 */
const updateProfilePhoto = asyncHandler(async (req, res) => {
  if (!req.file) {
    return sendError(res, 'Please select an image to upload', 400);
  }

  try {
    // Upload to ImageKit bucket
    const uploadResponse = await imagekit.upload({
      file: req.file.buffer,
      fileName: `admin_${req.user._id}_${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`,
      folder: '/admins/profiles',
    });

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { profilePhoto: uploadResponse.url } },
      { new: true }
    ).select('-password');

    sendSuccess(res, 'Profile photo updated successfully', {
      profilePhoto: updatedUser.profilePhoto
    });
  } catch (uploadErr) {
    console.error('Admin Photo Upload Error:', uploadErr);
    return sendError(res, 'Image server upload failed', 500);
  }
});

/**
 * @desc    Change Admin Password
 * @route   PUT /api/admin/profile/change-password
 * @access  Private/Admin
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!newPassword || !confirmPassword) {
    return sendError(res, 'New password and confirmation are required', 400);
  }

  if (newPassword !== confirmPassword) {
    return sendError(res, 'New passwords do not match', 400);
  }

  // Password rules: Min 6 characters
  if (newPassword.length < 6) {
    return sendError(res, 'Password must be minimum 6 characters', 400);
  }

  const user = await User.findById(req.user._id).select('+password');
  if (!user) {
    return sendError(res, 'Account could not be located', 404);
  }

  // Optional: Match current password ONLY if provided
  if (currentPassword && currentPassword.trim() !== '') {
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return sendError(res, 'Current password is incorrect', 401);
    }
  }

  // Save new password (trigger pre-save bcrypt hook)
  user.password = newPassword;
  await user.save();

  sendSuccess(res, 'Password updated successfully');
});

/**
 * @desc    Verify current password (frontend quick check)
 * @route   POST /api/admin/profile/verify-password
 * @access  Private/Admin
 */
const verifyCurrentPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return sendError(res, 'Please provide a password string', 400);
  }

  const user = await User.findById(req.user._id).select('+password');
  if (!user) {
    return sendError(res, 'Account not found', 404);
  }

  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    return sendError(res, 'Invalid credential', 401);
  }

  sendSuccess(res, 'Verification successful', { verified: true });
});

module.exports = {
  getAdminProfile,
  updateAdminProfile,
  updateProfilePhoto,
  changePassword,
  verifyCurrentPassword
};
