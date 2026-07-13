const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const knowledgeService = require('../services/knowledgeService');
const Announcement = require('../models/Announcement');
const monitoringService = require('../../ops/services/monitoringService');
const openapiService = require('../services/openapiService');

// All endpoints here are PUBLIC (no auth).

exports.knowledgeList = asyncHandler(async (req, res) => sendSuccess(res, 'Articles', await knowledgeService.listPublished({ category: req.query.category, search: req.query.search })));
exports.knowledgeCategories = asyncHandler(async (req, res) => sendSuccess(res, 'Categories', await knowledgeService.categories()));
exports.knowledgeGet = asyncHandler(async (req, res) => {
  const a = await knowledgeService.getBySlug(req.params.slug);
  if (!a) return sendError(res, 'Article not found', 404);
  return sendSuccess(res, 'Article', a);
});

exports.announcements = asyncHandler(async (req, res) => {
  const now = new Date();
  const items = await Announcement.find({ active: true, publishedAt: { $lte: now }, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }).sort({ publishedAt: -1 }).limit(50).lean();
  return sendSuccess(res, 'Announcements', items);
});

exports.releaseNotes = asyncHandler(async (req, res) => {
  const items = await Announcement.find({ active: true, type: 'release' }).sort({ publishedAt: -1 }).limit(50).lean();
  return sendSuccess(res, 'Release notes', items);
});

// Public status page: health summary + active incidents/maintenance.
exports.status = asyncHandler(async (req, res) => {
  const health = await monitoringService.health();
  const now = new Date();
  const incidents = await Announcement.find({ active: true, type: { $in: ['incident', 'maintenance'] }, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }).sort({ publishedAt: -1 }).lean();
  return sendSuccess(res, 'Status', {
    status: health.status,
    components: { api: 'operational', database: health.mongo.connected ? 'operational' : 'down', queues: health.queues ? 'operational' : 'unknown' },
    incidents,
    updatedAt: now,
  });
});

// Developer portal
exports.openapi = asyncHandler(async (req, res) => res.json(openapiService.buildSpec()));
exports.postman = asyncHandler(async (req, res) => res.json(openapiService.buildPostman()));
