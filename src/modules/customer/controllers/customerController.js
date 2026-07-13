const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const supportService = require('../services/supportService');
const apiKeyService = require('../services/apiKeyService');
const SupportTicket = require('../models/SupportTicket');
const { audit } = require('../../saas/utils/auditAny');

const wrap = (fn) => asyncHandler(async (req, res) => { try { return sendSuccess(res, 'OK', await fn(req)); } catch (e) { return sendError(res, e.message, e.status || 500); } });

// ---- Support (tenant context) ----
exports.listTickets = wrap((req) => supportService.listForTenant({ status: req.query.status }));
exports.createTicket = asyncHandler(async (req, res) => {
  try {
    const t = await supportService.create({ ...req.body, email: req.user?.email });
    return sendSuccess(res, 'Ticket created', t, 201);
  } catch (e) { return sendError(res, e.message, e.status || 500); }
});
exports.getTicket = asyncHandler(async (req, res) => {
  const t = await SupportTicket.findById(req.params.id).lean();
  if (!t) return sendError(res, 'Ticket not found', 404);
  return sendSuccess(res, 'Ticket', t);
});
exports.replyTicket = asyncHandler(async (req, res) => {
  try { return sendSuccess(res, 'Reply added', await supportService.reply(req.params.id, { body: req.body.body, email: req.user?.email })); }
  catch (e) { return sendError(res, e.message, e.status || 500); }
});
exports.closeTicket = asyncHandler(async (req, res) => {
  try { return sendSuccess(res, 'Ticket closed', await supportService.setStatus(req.params.id, 'closed')); }
  catch (e) { return sendError(res, e.message, e.status || 500); }
});

// ---- API keys (developer portal) ----
exports.listKeys = wrap(() => apiKeyService.list());
exports.createKey = asyncHandler(async (req, res) => {
  try {
    const k = await apiKeyService.generate({ name: req.body.name, scopes: req.body.scopes, email: req.user?.email });
    await audit(req, { action: 'API_KEY_CREATED', entity: 'TenantApiKey', entityId: k.id, newValues: { name: k.name, prefix: k.prefix } });
    return sendSuccess(res, 'API key created (shown once)', k, 201);
  } catch (e) { return sendError(res, e.message, e.status || 500); }
});
exports.revokeKey = asyncHandler(async (req, res) => {
  try { const r = await apiKeyService.revoke(req.params.id); await audit(req, { action: 'API_KEY_REVOKED', entity: 'TenantApiKey', entityId: req.params.id }); return sendSuccess(res, 'API key revoked', r); }
  catch (e) { return sendError(res, e.message, e.status || 500); }
});

// ---- Profile (read-only convenience; reuses existing user/tenant data) ----
exports.profile = asyncHandler(async (req, res) => {
  const Tenant = require('../../../models/Tenant');
  const tenant = await require('../../../tenancy/tenantContext').runAsSystem(() => Tenant.findById(req.tenantId).lean());
  return sendSuccess(res, 'Profile', {
    user: { id: req.user._id, fullName: req.user.fullName, email: req.user.email, role: req.user.role },
    company: tenant ? { name: tenant.companyName, code: tenant.companyCode, status: tenant.status, currency: tenant.currency } : null,
  });
});
