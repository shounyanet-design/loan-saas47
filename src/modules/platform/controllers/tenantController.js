const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const Tenant = require('../../../models/Tenant');
const TenantSettings = require('../../../models/TenantSettings');
const TenantApiSettings = require('../../../models/TenantApiSettings');
const Borrower = require('../../../models/Borrower');
const Staff = require('../../../models/Staff');
const User = require('../../../models/User');
const { buildQuery, paginate } = require('../utils/queryFeatures');
const { recordAudit } = require('../utils/audit');

// API uses uppercase status labels; the model stores canonical lowercase.
const STATUS_VALUES = ['ACTIVE', 'TRIAL', 'PENDING', 'SUSPENDED', 'EXPIRED', 'DISABLED'];
const toModelStatus = (s) => (s ? String(s).toLowerCase() : undefined);
const isValidStatus = (s) => STATUS_VALUES.includes(String(s).toUpperCase());
const EMAIL_RE = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;

function validateTenantInput(body, { partial = false } = {}) {
  const errors = [];
  const has = (k) => body[k] !== undefined && body[k] !== null && body[k] !== '';
  if (!partial || has('companyName')) {
    if (!has('companyName') || String(body.companyName).trim().length < 2) errors.push('companyName is required (min 2 chars)');
  }
  if (!partial || has('companyCode')) {
    if (!has('companyCode') || !/^[A-Za-z0-9_-]{2,20}$/.test(body.companyCode)) errors.push('companyCode is required (2-20 alphanumeric)');
  }
  if (has('email') && !EMAIL_RE.test(body.email)) errors.push('email is invalid');
  if (has('phone') && !/^[0-9+()\-\s]{6,20}$/.test(body.phone)) errors.push('phone is invalid');
  if (has('status') && !isValidStatus(body.status)) errors.push(`status must be one of ${STATUS_VALUES.join(', ')}`);
  return errors;
}

// @route GET /api/platform/tenants
exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip, sort, filter } = buildQuery(req.query, {
    searchFields: ['companyName', 'companyCode', 'email', 'phone', 'owner'],
    filterFields: ['status', 'subscriptionStatus', 'country'],
    sortFields: ['companyName', 'companyCode', 'status', 'createdAt', 'lastLoginAt'],
    defaultSort: 'createdAt',
  });
  // Normalise an uppercase status filter to canonical lowercase.
  if (filter.status) filter.status = toModelStatus(filter.status);

  const [items, total] = await Promise.all([
    Tenant.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Tenant.countDocuments(filter),
  ]);
  return sendSuccess(res, 'Tenants', paginate(items, total, page, limit));
});

// @route GET /api/platform/tenants/:id
exports.getOne = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.params.id).lean();
  if (!tenant) return sendError(res, 'Tenant not found', 404);

  // Augment with live per-tenant counts (system-mode → must scope explicitly).
  const [borrowers, staff, users] = await Promise.all([
    Borrower.countDocuments({ tenantId: tenant._id }),
    Staff.countDocuments({ tenantId: tenant._id }),
    User.countDocuments({ tenantId: tenant._id }),
  ]);
  return sendSuccess(res, 'Tenant', { ...tenant, counts: { borrowers, staff, users } });
});

// @route POST /api/platform/tenants
exports.create = asyncHandler(async (req, res) => {
  const errors = validateTenantInput(req.body);
  if (errors.length) return sendError(res, errors.join('; '), 400);

  const companyCode = String(req.body.companyCode).toUpperCase().trim();
  const email = req.body.email ? String(req.body.email).toLowerCase().trim() : '';

  if (await Tenant.findOne({ companyCode })) return sendError(res, 'companyCode already exists', 409);
  if (email && (await Tenant.findOne({ email }))) return sendError(res, 'email already in use by another tenant', 409);

  const tenant = await Tenant.create({
    companyName: req.body.companyName,
    companyCode,
    email,
    status: toModelStatus(req.body.status) || 'pending',
    subscriptionStatus: req.body.subscriptionStatus || 'none',
    timezone: req.body.timezone,
    currency: req.body.currency,
    locale: req.body.locale,
    country: req.body.country,
    phone: req.body.phone,
    owner: req.body.owner,
    brandLogo: req.body.brandLogo,
    primaryColor: req.body.primaryColor,
    secondaryColor: req.body.secondaryColor,
    maxUsers: req.body.maxUsers,
    maxBorrowers: req.body.maxBorrowers,
    maxStorage: req.body.maxStorage,
  });

  // Provision the per-tenant settings rows (mirrors migration 001 behavior).
  await TenantSettings.updateOne({ tenantId: tenant._id }, { $setOnInsert: { tenantId: tenant._id } }, { upsert: true });
  await TenantApiSettings.updateOne({ tenantId: tenant._id }, { $setOnInsert: { tenantId: tenant._id } }, { upsert: true });

  await recordAudit(req, { action: 'TENANT_CREATED', entity: 'Tenant', entityId: tenant._id, newValues: tenant.toObject() });
  return sendSuccess(res, 'Tenant created', tenant, 201);
});

// @route PUT /api/platform/tenants/:id
exports.update = asyncHandler(async (req, res) => {
  const errors = validateTenantInput(req.body, { partial: true });
  if (errors.length) return sendError(res, errors.join('; '), 400);

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return sendError(res, 'Tenant not found', 404);
  const before = tenant.toObject();

  if (req.body.companyCode) {
    const code = String(req.body.companyCode).toUpperCase().trim();
    if (code !== tenant.companyCode && (await Tenant.findOne({ companyCode: code }))) {
      return sendError(res, 'companyCode already exists', 409);
    }
    tenant.companyCode = code;
  }
  if (req.body.email !== undefined) {
    const email = String(req.body.email).toLowerCase().trim();
    if (email && email !== tenant.email && (await Tenant.findOne({ email }))) {
      return sendError(res, 'email already in use by another tenant', 409);
    }
    tenant.email = email;
  }

  const editable = ['companyName', 'subscriptionStatus', 'timezone', 'currency', 'locale', 'country',
    'phone', 'owner', 'brandLogo', 'primaryColor', 'secondaryColor', 'maxUsers', 'maxBorrowers', 'maxStorage'];
  editable.forEach((f) => { if (req.body[f] !== undefined) tenant[f] = req.body[f]; });
  if (req.body.status !== undefined) tenant.status = toModelStatus(req.body.status);

  await tenant.save();
  await recordAudit(req, { action: 'TENANT_UPDATED', entity: 'Tenant', entityId: tenant._id, oldValues: before, newValues: tenant.toObject() });
  return sendSuccess(res, 'Tenant updated', tenant);
});

// Shared status transition helper.
async function setStatus(req, res, status, action) {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return sendError(res, 'Tenant not found', 404);
  if (tenant.isDefault && (status === 'suspended' || status === 'disabled')) {
    return sendError(res, 'The default tenant cannot be suspended or disabled', 400);
  }
  const before = { status: tenant.status };
  tenant.status = status;
  await tenant.save();
  await recordAudit(req, { action, entity: 'Tenant', entityId: tenant._id, oldValues: before, newValues: { status } });
  return sendSuccess(res, `Tenant ${status}`, tenant);
}

// @route PATCH /api/platform/tenants/:id/suspend
exports.suspend = asyncHandler((req, res) => setStatus(req, res, 'suspended', 'TENANT_SUSPENDED'));
// @route PATCH /api/platform/tenants/:id/activate
exports.activate = asyncHandler((req, res) => setStatus(req, res, 'active', 'TENANT_ACTIVATED'));

// @route DELETE /api/platform/tenants/:id
// Soft delete by default (status=disabled). Hard delete requires ?hard=true.
exports.remove = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return sendError(res, 'Tenant not found', 404);
  if (tenant.isDefault) return sendError(res, 'The default tenant cannot be deleted', 400);

  if (String(req.query.hard) === 'true') {
    await Tenant.deleteOne({ _id: tenant._id });
    await recordAudit(req, { action: 'TENANT_HARD_DELETED', entity: 'Tenant', entityId: tenant._id, oldValues: tenant.toObject() });
    return sendSuccess(res, 'Tenant permanently deleted', { _id: tenant._id });
  }
  const before = { status: tenant.status };
  tenant.status = 'disabled';
  await tenant.save();
  await recordAudit(req, { action: 'TENANT_DISABLED', entity: 'Tenant', entityId: tenant._id, oldValues: before, newValues: { status: 'disabled' } });
  return sendSuccess(res, 'Tenant disabled (soft delete)', tenant);
});
