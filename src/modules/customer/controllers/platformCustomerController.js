const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const knowledgeService = require('../services/knowledgeService');
const supportService = require('../services/supportService');
const Announcement = require('../models/Announcement');
const { audit } = require('../../saas/utils/auditAny');

// Platform/super-admin management of customer-facing content. SYSTEM mode.

// Knowledge base CRUD
exports.kbList = asyncHandler(async (req, res) => sendSuccess(res, 'Articles', await knowledgeService.listAll()));
exports.kbCreate = asyncHandler(async (req, res) => {
  try { const a = await knowledgeService.create(req.body); await audit(req, { action: 'KB_ARTICLE_CREATED', entity: 'KnowledgeArticle', entityId: a._id }); return sendSuccess(res, 'Article created', a, 201); }
  catch (e) { return sendError(res, e.message, e.status || 500); }
});
exports.kbUpdate = asyncHandler(async (req, res) => {
  try { const a = await knowledgeService.update(req.params.id, req.body); await audit(req, { action: 'KB_ARTICLE_UPDATED', entity: 'KnowledgeArticle', entityId: a._id }); return sendSuccess(res, 'Article updated', a); }
  catch (e) { return sendError(res, e.message, e.status || 500); }
});
exports.kbDelete = asyncHandler(async (req, res) => { await knowledgeService.remove(req.params.id); await audit(req, { action: 'KB_ARTICLE_DELETED', entity: 'KnowledgeArticle', entityId: req.params.id }); return sendSuccess(res, 'Article deleted'); });

// Announcements CRUD
exports.annList = asyncHandler(async (req, res) => sendSuccess(res, 'Announcements', await Announcement.find({}).sort({ publishedAt: -1 }).lean()));
exports.annCreate = asyncHandler(async (req, res) => {
  if (!req.body.title) return sendError(res, 'title required', 400);
  const a = await Announcement.create(req.body);
  await audit(req, { action: 'ANNOUNCEMENT_CREATED', entity: 'Announcement', entityId: a._id });
  return sendSuccess(res, 'Announcement created', a, 201);
});
exports.annUpdate = asyncHandler(async (req, res) => {
  const a = await Announcement.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
  if (!a) return sendError(res, 'Not found', 404);
  await audit(req, { action: 'ANNOUNCEMENT_UPDATED', entity: 'Announcement', entityId: a._id });
  return sendSuccess(res, 'Announcement updated', a);
});

// Support triage (all tenants)
exports.ticketsAll = asyncHandler(async (req, res) => sendSuccess(res, 'Tickets', await supportService.listAll({ status: req.query.status })));
exports.ticketReply = asyncHandler(async (req, res) => {
  const SupportTicket = require('../models/SupportTicket');
  const ticket = await require('../../../tenancy/tenantContext').runAsSystem(() => SupportTicket.findById(req.params.id).lean());
  if (!ticket) return sendError(res, 'Ticket not found', 404);
  try { const t = await supportService.agentReply(ticket.tenantId, req.params.id, { body: req.body.body, email: req.platformUser.email }); await audit(req, { action: 'SUPPORT_REPLIED', entity: 'SupportTicket', entityId: req.params.id }); return sendSuccess(res, 'Reply added', t); }
  catch (e) { return sendError(res, e.message, e.status || 500); }
});
