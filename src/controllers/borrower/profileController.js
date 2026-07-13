const Borrower = require('../../models/Borrower');
const User = require('../../models/User');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const imagekit = require('../../config/imagekit');
const bcrypt = require('bcryptjs');

/**
 * @desc    Get logged-in Borrower profile
 * @route   GET /api/borrower/profile
 * @access  Private/Borrower
 */
const getProfile = asyncHandler(async (req, res) => {
  const borrower = await Borrower.findOne({ userId: req.user._id });
  
  if (!borrower) {
    return sendError(res, 'Borrower profile record missing.', 404);
  }

  // Fetch full user object to get additional fields if needed
  const user = await User.findById(req.user._id);

  sendSuccess(res, 'Profile loaded successfully', {
    id: borrower._id,
    userId: borrower.userId,
    fullName: borrower.fullName,
    email: borrower.email,
    phoneNumber: borrower.phoneNumber,
    dateOfBirth: borrower.dateOfBirth || user?.dateOfBirth,
    address: borrower.physicalAddress || user?.address,
    residentialArea: borrower.residentialArea,
    profilePhoto: borrower.profilePhoto || user?.profilePhoto,
    accountStatus: borrower.accountStatus,
    borrowerCode: borrower.borrowerCode,
    isBlacklisted: borrower.isBlacklisted,
    isFrozen: borrower.isFrozen
  });
});

/**
 * @desc    Update Borrower personal information
 * @route   PUT /api/borrower/profile/update
 * @access  Private/Borrower
 */
const updateProfile = asyncHandler(async (req, res) => {
  const { fullName, phoneNumber, dateOfBirth, address, residentialArea } = req.body;
  
  const borrower = await Borrower.findOne({ userId: req.user._id });
  if (!borrower) {
    return sendError(res, 'Borrower profile not found', 404);
  }

  if (borrower.isFrozen || borrower.isBlacklisted) {
    return sendError(res, 'Your account is restricted. Update denied.', 403);
  }

  // Update allowed fields only
  if (fullName) borrower.fullName = fullName;
  if (phoneNumber) borrower.phoneNumber = phoneNumber;
  if (dateOfBirth) borrower.dateOfBirth = dateOfBirth;
  if (address) borrower.physicalAddress = address;
  if (residentialArea) borrower.residentialArea = residentialArea;

  await borrower.save();

  // Also sync with User model
  const userUpdates = {};
  if (fullName) userUpdates.fullName = fullName;
  if (phoneNumber) {
    userUpdates.phoneNumber = phoneNumber;
    userUpdates.phone = phoneNumber; // legacy sync
  }
  if (dateOfBirth) userUpdates.dateOfBirth = dateOfBirth;
  if (address) userUpdates.address = address;

  await User.findByIdAndUpdate(req.user._id, { $set: userUpdates });

  sendSuccess(res, 'Profile updated successfully', {
    fullName: borrower.fullName,
    phoneNumber: borrower.phoneNumber,
    dateOfBirth: borrower.dateOfBirth,
    address: borrower.physicalAddress,
    residentialArea: borrower.residentialArea
  });
});

/**
 * @desc    Update Borrower Profile Photo
 * @route   PUT /api/borrower/profile/photo
 * @access  Private/Borrower
 */
const updateProfilePhoto = asyncHandler(async (req, res) => {
  if (!req.file) {
    return sendError(res, 'Please upload an image', 400);
  }

  const borrower = await Borrower.findOne({ userId: req.user._id });
  if (!borrower) {
    return sendError(res, 'Borrower profile not found', 404);
  }

  try {
    // Upload to ImageKit
    const uploadResponse = await imagekit.upload({
      file: req.file.buffer,
      fileName: `borrower_${borrower.borrowerCode || borrower._id}_${Date.now()}`,
      folder: '/borrowers/profiles',
    });

    // Update Borrower model
    borrower.profilePhoto = uploadResponse.url;
    borrower.profilePhotoFileId = uploadResponse.fileId;
    await borrower.save();

    // Sync with User model
    await User.findByIdAndUpdate(req.user._id, {
      profilePhoto: uploadResponse.url
    });

    sendSuccess(res, 'Profile photo updated successfully', {
      profilePhoto: uploadResponse.url
    });
  } catch (error) {
    console.error('Borrower Photo Upload Error:', error);
    return sendError(res, 'Failed to upload photo to server', 500);
  }
});

/**
 * @desc    Update Borrower Password
 * @route   PUT /api/borrower/profile/change-password
 * @access  Private/Borrower
 */
const updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!newPassword || !confirmPassword) {
    return sendError(res, 'New password and confirmation are required', 400);
  }

  if (newPassword !== confirmPassword) {
    return sendError(res, 'Passwords do not match', 400);
  }

  if (newPassword.length < 6) {
    return sendError(res, 'Password must be at least 6 characters', 400);
  }

  const user = await User.findById(req.user._id).select('+password');
  const borrower = await Borrower.findOne({ userId: req.user._id });

  if (!user || !borrower) {
    return sendError(res, 'Account not found', 404);
  }

  // Verify current password
  if (currentPassword && currentPassword.trim() !== '') {
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return sendError(res, 'Current password is incorrect', 400);
    }
  }

  // Update password in User model (triggers pre-save hook)
  user.password = newPassword;
  await user.save();

  // Update password in Borrower model (triggers pre-save hook)
  borrower.password = newPassword;
  await borrower.save();

  sendSuccess(res, 'Password updated successfully');
});

module.exports = {
  getProfile,
  updateProfile,
  updateProfilePhoto,
  updatePassword
};
