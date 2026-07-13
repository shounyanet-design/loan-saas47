const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const monitoringService = require('../services/monitoringService');
const queueService = require('../services/queueService');
const loggingService = require('../services/loggingService');
const backupService = require('../services/backupService');
const domainService = require('../services/domainService');
const { audit } = require('../../saas/utils/auditAny');

// Monitoring
exports.monitoring = asyncHandler(async (req, res) => sendSuccess(res, 'Platform health', await monitoringService.health()));

// Queues
exports.queueStats = asyncHandler(async (req, res) => sendSuccess(res, 'Queue stats', await queueService.stats()));
exports.deadLetters = asyncHandler(async (req, res) => sendSuccess(res, 'Dead letter queue', await queueService.deadLetters({ limit: Number(req.query.limit) || 50 })));
exports.retryDead = asyncHandler(async (req, res) => {
  const r = await queueService.retryDead(req.params.jobId);
  if (!r) return sendError(res, 'Job not found in DLQ', 404);
  await audit(req, { action: 'QUEUE_JOB_RETRIED', entity: 'JobRecord', entityId: req.params.jobId });
  return sendSuccess(res, 'Job re-queued', r);
});

// Logs
exports.logs = asyncHandler(async (req, res) => {
  const { category, level, limit, skip } = req.query;
  return sendSuccess(res, 'Logs', await loggingService.query({ category, level, limit: Number(limit) || 100, skip: Number(skip) || 0 }));
});

// Backups
exports.listBackups = asyncHandler(async (req, res) => sendSuccess(res, 'Backups', await backupService.list({})));
exports.createBackup = asyncHandler(async (req, res) => {
  const rec = await backupService.createLogicalBackup({ triggeredBy: req.platformUser.email });
  await audit(req, { action: 'BACKUP_CREATED', entity: 'BackupRecord', entityId: rec._id });
  return sendSuccess(res, 'Backup created', rec, 201);
});
exports.verifyBackup = asyncHandler(async (req, res) => sendSuccess(res, 'Backup verification', await backupService.verifyBackup(req.params.id)));
exports.restoreBackup = asyncHandler(async (req, res) => {
  const r = await backupService.restoreLogicalBackup(req.params.id, { force: req.body.force === true, collections: req.body.collections });
  await audit(req, { action: 'BACKUP_RESTORED', entity: 'BackupRecord', entityId: req.params.id, newValues: { force: req.body.force === true } });
  return sendSuccess(res, 'Restore complete', r);
});

// Domains (platform view + force verify)
exports.forceVerifyDomain = asyncHandler(async (req, res) => {
  const doc = await domainService.forceVerify(req.params.id);
  await audit(req, { action: 'DOMAIN_FORCE_VERIFIED', entity: 'TenantDomain', entityId: req.params.id });
  return sendSuccess(res, 'Domain verified', doc);
});
