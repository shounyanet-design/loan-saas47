const Staff = require('../../models/Staff');
const User = require('../../models/User');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const imagekit = require('../../config/imagekit');
const bcrypt = require('bcryptjs');

/**
 * @desc    Get logged-in Staff profile
 * @route   GET /api/staff/profile
 * @access  Private/Staff
 */
const getStaffProfile = asyncHandler(async (req, res) => {
  let staff = await Staff.findOne({ userId: req.user._id });
  
  // SELF-HEALING: If user is Staff but record is missing, create it automatically
  if (!staff && req.user.role === 'staff') {
    console.log(`Auto-generating missing Staff record for: ${req.user.email}`);
    staff = await Staff.create({
      userId: req.user._id,
      fullName: req.user.fullName,
      email: req.user.email,
      password: 'Point47@Staff', // Required by model validation
      phoneNumber: req.user.phone || req.user.phoneNumber || '0000000000',
      idNumber: 'STF-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      gender: 'Other',
      dateOfBirth: req.user.dateOfBirth || new Date('1990-01-01'),
      physicalAddress: req.user.address || 'Not Provided',
      department: 'General',
      designation: 'Staff Member',
      joiningDate: new Date(),
      reportingManager: 'System Admin',
      branchRegion: req.user.primaryBranch || 'Head Office',
      status: 'Active'
    });
  }

  if (!staff) {
    if (req.user.role === 'admin') {
      return sendError(res, 'Administrator record found, but no Staff profile exists for this account. Please use Admin Profile.', 404);
    }
    return sendError(res, 'Profile record missing. Please contact administrator.', 404);
  }

  // Business Rule: Suspended staff cannot access profile APIs
  if (staff.status === 'Suspended') {
    return sendError(res, 'Your account is suspended. Access denied.', 403);
  }

  sendSuccess(res, 'Profile loaded successfully', {
    fullName: staff.fullName,
    email: staff.email,
    phoneNumber: staff.phoneNumber,
    dateOfBirth: staff.dateOfBirth,
    address: staff.physicalAddress,
    primaryBranch: staff.branchRegion,
    role: staff.role,
    designation: staff.designation,
    profilePhoto: staff.profilePhoto?.url || null,
    accountStatus: staff.status,
    employeeId: staff.employeeId,
    joiningDate: staff.joiningDate
  });
});

/**
 * @desc    Update Staff personal information
 * @route   PUT /api/staff/profile/update
 * @access  Private/Staff
 */
const updateStaffProfile = asyncHandler(async (req, res) => {
  const { fullName, phoneNumber, dateOfBirth, address } = req.body;
  
  const staff = await Staff.findOne({ userId: req.user._id });
  if (!staff) {
    return sendError(res, 'Staff profile not found', 404);
  }

  if (staff.status === 'Suspended') {
    return sendError(res, 'Your account is suspended. Update denied.', 403);
  }

  // Update allowed fields only
  if (fullName) staff.fullName = fullName;
  if (phoneNumber) staff.phoneNumber = phoneNumber;
  if (dateOfBirth) staff.dateOfBirth = dateOfBirth;
  if (address) staff.physicalAddress = address;

  await staff.save();

  // Also sync with User model if necessary (fullName and phoneNumber are shared)
  await User.findByIdAndUpdate(req.user._id, {
    fullName: staff.fullName,
    phoneNumber: staff.phoneNumber,
    phone: staff.phoneNumber // legacy sync
  });

  sendSuccess(res, 'Profile updated successfully', {
    fullName: staff.fullName,
    phoneNumber: staff.phoneNumber,
    dateOfBirth: staff.dateOfBirth,
    address: staff.physicalAddress
  });
});

/**
 * @desc    Update Staff Password
 * @route   PUT /api/staff/profile/change-password
 * @access  Private/Staff
 */
const changeStaffPassword = asyncHandler(async (req, res) => {
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
  const staff = await Staff.findOne({ userId: req.user._id });

  if (!user || !staff) {
    return sendError(res, 'Account not found', 404);
  }

  if (staff.status === 'Suspended') {
    return sendError(res, 'Your account is suspended.', 403);
  }

  // Verify current password ONLY if provided (matches Admin logic)
  if (currentPassword && currentPassword.trim() !== '') {
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return sendError(res, 'Current password is incorrect', 401);
    }
  }

  // Update password in User model (triggers pre-save hook)
  user.password = newPassword;
  await user.save();

  // Also update in Staff model if it stores password (which it does based on schema)
  staff.password = newPassword;
  await staff.save();

  sendSuccess(res, 'Password updated successfully');
});

/**
 * @desc    Upload Staff Profile Photo
 * @route   PUT /api/staff/profile/upload-photo
 * @access  Private/Staff
 */
const uploadStaffProfilePhoto = asyncHandler(async (req, res) => {
  if (!req.file) {
    return sendError(res, 'Please upload an image', 400);
  }

  const staff = await Staff.findOne({ userId: req.user._id });
  if (!staff) {
    return sendError(res, 'Staff profile not found', 404);
  }

  if (staff.status === 'Suspended') {
    return sendError(res, 'Your account is suspended.', 403);
  }

  try {
    // Upload to ImageKit
    const uploadResponse = await imagekit.upload({
      file: req.file.buffer,
      fileName: `staff_${staff.employeeId}_${Date.now()}`,
      folder: '/staff/profiles',
    });

    // Update Staff model
    staff.profilePhoto = {
      url: uploadResponse.url,
      fileId: uploadResponse.fileId
    };
    await staff.save();

    // Sync with User model
    await User.findByIdAndUpdate(req.user._id, {
      profilePhoto: uploadResponse.url
    });

    sendSuccess(res, 'Profile photo updated successfully', {
      profilePhoto: uploadResponse.url
    });
  } catch (error) {
    console.error('Photo Upload Error:', error);
    return sendError(res, 'Failed to upload photo to server', 500);
  }
});

module.exports = {
  getStaffProfile,
  updateStaffProfile,
  changeStaffPassword,
  uploadStaffProfilePhoto
};
