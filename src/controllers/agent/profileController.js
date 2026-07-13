const Agent = require('../../models/Agent');
const User = require('../../models/User');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const imagekit = require('../../config/imagekit');
const bcrypt = require('bcryptjs');

/**
 * @desc    Get logged-in Agent profile
 * @route   GET /api/agent/profile
 * @access  Private/Agent
 */
const getAgentProfile = asyncHandler(async (req, res) => {
  let agent = await Agent.findOne({ userId: req.user._id });
  
  // SELF-HEALING: If user is Agent but record is missing, create it automatically
  if (!agent && req.user.role === 'agent') {
    console.log(`Auto-generating missing Agent record for: ${req.user.email}`);
    agent = await Agent.create({
      userId: req.user._id,
      fullName: req.user.fullName,
      email: req.user.email,
      password: 'Point47@Agent', // Required by model validation
      phoneNumber: req.user.phone || req.user.phoneNumber || '0000000000',
      idNumber: 'AGT-ID-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      physicalAddress: req.user.address || 'Not Provided',
      assignedRegion: req.user.primaryBranch || 'Head Office',
      joiningDate: new Date(),
      reportingManager: 'System Admin',
      role: 'Field Agent',
      baseCommission: 5,
      recoveryBonus: 2,
      commissionTier: 'Standard',
      accountStatus: 'Active'
    });
  }

  if (!agent) {
    if (req.user.role === 'admin' || req.user.role === 'staff') {
      return sendError(res, 'Administrator or Staff record found, but no Agent profile exists for this account. Please use correct Profile.', 404);
    }
    return sendError(res, 'Profile record missing. Please contact administrator.', 404);
  }

  // Business Rule: Suspended agents cannot access profile APIs
  if (agent.accountStatus === 'Suspended') {
    return sendError(res, 'Your account is suspended. Access denied.', 403);
  }

  // Fetch full user object to get dateOfBirth (since it's on User schema)
  const user = await User.findById(req.user._id);

  sendSuccess(res, 'Profile loaded successfully', {
    id: agent._id,
    userId: agent.userId,
    fullName: agent.fullName,
    email: agent.email,
    phone: agent.phoneNumber,
    dateOfBirth: user?.dateOfBirth, // Get from User model
    address: agent.physicalAddress,
    branch: agent.assignedRegion,
    profileImage: agent.profilePhoto || null,
    role: agent.role,
    designation: agent.role,
    status: agent.accountStatus,
    employeeId: agent.employeeId,
    joiningDate: agent.joiningDate
  });
});

/**
 * @desc    Update Agent personal information
 * @route   PUT /api/agent/profile
 * @access  Private/Agent
 */
const updateAgentProfile = asyncHandler(async (req, res) => {
  const { fullName, phone, dateOfBirth, address } = req.body;
  
  const agent = await Agent.findOne({ userId: req.user._id });
  if (!agent) {
    return sendError(res, 'Agent profile not found', 404);
  }

  if (agent.accountStatus === 'Suspended') {
    return sendError(res, 'Your account is suspended. Update denied.', 403);
  }

  // Update allowed fields only
  if (fullName) agent.fullName = fullName;
  if (phone) agent.phoneNumber = phone;
  if (dateOfBirth) agent.dateOfBirth = dateOfBirth; // assuming dateOfBirth can be added or stored in User
  if (address) agent.physicalAddress = address;

  await agent.save();

  // Also sync with User model
  const userUpdates = {};
  if (fullName) userUpdates.fullName = fullName;
  if (phone) {
    userUpdates.phoneNumber = phone;
    userUpdates.phone = phone; // legacy sync
  }
  if (dateOfBirth) userUpdates.dateOfBirth = dateOfBirth;
  if (address) userUpdates.address = address;

  await User.findByIdAndUpdate(req.user._id, userUpdates);

  sendSuccess(res, 'Profile updated successfully', {
    fullName: agent.fullName,
    phone: agent.phoneNumber,
    dateOfBirth: agent.dateOfBirth,
    address: agent.physicalAddress
  });
});

/**
 * @desc    Update Agent Profile Photo
 * @route   PATCH /api/agent/profile/image
 * @access  Private/Agent
 */
const uploadAgentProfilePhoto = asyncHandler(async (req, res) => {
  if (!req.file) {
    return sendError(res, 'Please upload an image', 400);
  }

  const agent = await Agent.findOne({ userId: req.user._id });
  if (!agent) {
    return sendError(res, 'Agent profile not found', 404);
  }

  if (agent.accountStatus === 'Suspended') {
    return sendError(res, 'Your account is suspended.', 403);
  }

  try {
    // Upload to ImageKit
    const uploadResponse = await imagekit.upload({
      file: req.file.buffer,
      fileName: `agent_${agent.employeeId || agent._id}_${Date.now()}`,
      folder: '/agents/profiles',
    });

    // Update Agent model
    agent.profilePhoto = uploadResponse.url;
    agent.profilePhotoFileId = uploadResponse.fileId;
    await agent.save();

    // Sync with User model
    await User.findByIdAndUpdate(req.user._id, {
      profilePhoto: uploadResponse.url
    });

    sendSuccess(res, 'Profile photo updated successfully', {
      profileImage: uploadResponse.url
    });
  } catch (error) {
    console.error('Photo Upload Error:', error);
    return sendError(res, 'Failed to upload photo to server', 500);
  }
});

/**
 * @desc    Update Agent Password
 * @route   PATCH /api/agent/profile/password
 * @access  Private/Agent
 */
const changeAgentPassword = asyncHandler(async (req, res) => {
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
  const agent = await Agent.findOne({ userId: req.user._id });

  if (!user || !agent) {
    return sendError(res, 'Account not found', 404);
  }

  if (agent.accountStatus === 'Suspended') {
    return sendError(res, 'Your account is suspended.', 403);
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

  // Update password in Agent model (triggers pre-save hook)
  agent.password = newPassword;
  await agent.save();

  sendSuccess(res, 'Password updated successfully');
});

/**
 * @desc    Get Profile Activity
 * @route   GET /api/agent/profile/activity
 * @access  Private/Agent
 */
const getProfileActivity = asyncHandler(async (req, res) => {
  const agent = await Agent.findOne({ userId: req.user._id });
  const user = await User.findById(req.user._id);

  if (!agent) {
    return sendError(res, 'Agent profile not found', 404);
  }

  sendSuccess(res, 'Profile activity loaded', {
    lastLogin: user.updatedAt,
    profileUpdatedAt: agent.updatedAt,
    accountCreatedAt: agent.createdAt
  });
});

module.exports = {
  getAgentProfile,
  updateAgentProfile,
  uploadAgentProfilePhoto,
  changeAgentPassword,
  getProfileActivity
};
