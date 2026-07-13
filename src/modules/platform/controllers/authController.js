const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const PlatformUser = require('../models/PlatformUser');
const { generatePlatformToken } = require('../utils/platformToken');
const { recordAudit } = require('../utils/audit');

const publicUser = (u) => ({
  _id: u._id,
  fullName: u.fullName,
  email: u.email,
  role: u.role,
  permissions: u.permissions,
  profilePhoto: u.profilePhoto,
  lastLogin: u.lastLogin,
});

// @route POST /api/platform/auth/login
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return sendError(res, 'Please provide email and password', 400);

  const user = await PlatformUser.findOne({ email: String(email).toLowerCase() }).select('+password');
  if (!user) return sendError(res, 'Invalid credentials', 401);

  const match = await user.matchPassword(password);
  if (!match) return sendError(res, 'Invalid credentials', 401);
  if (!user.isActive) return sendError(res, 'Platform account is disabled', 403);

  user.lastLogin = new Date();
  await user.save();

  const token = generatePlatformToken(user);
  return sendSuccess(res, 'Login successful', { user: publicUser(user), token });
});

// @route GET /api/platform/auth/me  (protected)
exports.getMe = asyncHandler(async (req, res) => {
  return sendSuccess(res, 'Platform user', publicUser(req.platformUser));
});

// @route PUT /api/platform/auth/change-password  (protected)
exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return sendError(res, 'Provide current and new password', 400);
  if (String(newPassword).length < 8) return sendError(res, 'New password must be at least 8 characters', 400);

  const user = await PlatformUser.findById(req.platformUser._id).select('+password');
  const ok = await user.matchPassword(currentPassword);
  if (!ok) return sendError(res, 'Current password is incorrect', 401);

  user.password = newPassword;
  await user.save();
  await recordAudit(req, { action: 'PLATFORM_PASSWORD_CHANGED', entity: 'PlatformUser', entityId: user._id });
  return sendSuccess(res, 'Password updated');
});

// @route PUT /api/platform/auth/profile  (protected)
exports.updateProfile = asyncHandler(async (req, res) => {
  const { fullName, profilePhoto } = req.body;
  const user = await PlatformUser.findById(req.platformUser._id);
  if (fullName !== undefined) user.fullName = fullName;
  if (profilePhoto !== undefined) user.profilePhoto = profilePhoto;
  await user.save();
  await recordAudit(req, { action: 'PLATFORM_PROFILE_UPDATED', entity: 'PlatformUser', entityId: user._id });
  return sendSuccess(res, 'Profile updated', publicUser(user));
});
