const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const PlatformUser = require('../models/PlatformUser');
const { buildQuery, paginate } = require('../utils/queryFeatures');
const { recordAudit } = require('../utils/audit');

const EMAIL_RE = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
const publicUser = (u) => {
  const o = u.toObject ? u.toObject() : u;
  delete o.password;
  return o;
};

// @route GET /api/platform/platform-users
exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip, sort, filter } = buildQuery(req.query, {
    searchFields: ['fullName', 'email'],
    filterFields: ['isActive', 'role'],
    sortFields: ['createdAt', 'fullName', 'email', 'lastLogin'],
    defaultSort: 'createdAt',
  });
  const [items, total] = await Promise.all([
    PlatformUser.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    PlatformUser.countDocuments(filter),
  ]);
  return sendSuccess(res, 'Platform users', paginate(items, total, page, limit));
});

// @route POST /api/platform/platform-users
exports.create = asyncHandler(async (req, res) => {
  const { fullName, email, password, permissions } = req.body;
  if (!fullName || !email || !password) return sendError(res, 'fullName, email and password are required', 400);
  if (!EMAIL_RE.test(email)) return sendError(res, 'email is invalid', 400);
  if (String(password).length < 8) return sendError(res, 'password must be at least 8 characters', 400);
  if (await PlatformUser.findOne({ email: String(email).toLowerCase() })) return sendError(res, 'email already in use', 409);

  const user = await PlatformUser.create({
    fullName,
    email: String(email).toLowerCase(),
    password,
    ...(Array.isArray(permissions) && permissions.length ? { permissions } : {}),
  });
  await recordAudit(req, { action: 'PLATFORM_USER_CREATED', entity: 'PlatformUser', entityId: user._id, newValues: { email: user.email, fullName: user.fullName } });
  return sendSuccess(res, 'Platform user created', publicUser(user), 201);
});

// @route PATCH /api/platform/platform-users/:id/status
exports.setActive = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  const user = await PlatformUser.findById(req.params.id);
  if (!user) return sendError(res, 'Platform user not found', 404);
  if (String(user._id) === String(req.platformUser._id) && isActive === false) {
    return sendError(res, 'You cannot disable your own account', 400);
  }
  user.isActive = !!isActive;
  await user.save();
  await recordAudit(req, { action: 'PLATFORM_USER_STATUS_CHANGED', entity: 'PlatformUser', entityId: user._id, newValues: { isActive: user.isActive } });
  return sendSuccess(res, 'Platform user updated', publicUser(user));
});
