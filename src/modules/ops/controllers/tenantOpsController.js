const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const domainService = require('../services/domainService');
const domainAvailabilityService = require('../services/domainAvailabilityService');
const monitoringService = require('../services/monitoringService');
const backupService = require('../services/backupService');
const { audit } = require('../../saas/utils/auditAny');

// Tenant self-service ops. Runs in tenant context (protect + admin).

// Domains
exports.listDomains = asyncHandler(async (req, res) => sendSuccess(res, 'Domains', await domainService.listForTenant(req.tenantId)));
exports.addDomain = asyncHandler(async (req, res) => {
  try {
    const doc = await domainService.addDomain(req.tenantId, { domain: req.body.domain, type: req.body.type, isPrimary: req.body.isPrimary });
    await audit(req, { action: 'DOMAIN_ADDED', entity: 'TenantDomain', entityId: doc._id, newValues: { domain: doc.domain } });
    return sendSuccess(res, 'Domain added — add the TXT record then verify', { domain: doc, txtRecord: `${domainService.VERIFY_PREFIX}${doc.verificationToken}` }, 201);
  } catch (e) { return sendError(res, e.message, e.status || 500); }
});
exports.verifyDomain = asyncHandler(async (req, res) => {
  try { return sendSuccess(res, 'Verification result', await domainService.verifyDomain(req.tenantId, req.params.id)); }
  catch (e) { return sendError(res, e.message, e.status || 500); }
});
exports.removeDomain = asyncHandler(async (req, res) => {
  await domainService.removeDomain(req.tenantId, req.params.id);
  await audit(req, { action: 'DOMAIN_REMOVED', entity: 'TenantDomain', entityId: req.params.id });
  return sendSuccess(res, 'Domain removed');
});

// Domain Availability (Case 3)
exports.checkAvailability = asyncHandler(async (req, res) => {
  const { domain } = req.query;
  if (!domain) return sendError(res, 'Domain parameter is required', 400);
  try {
    const result = await domainAvailabilityService.checkAvailability(domain);
    return sendSuccess(res, 'Availability result', result);
  } catch (e) {
    return sendError(res, e.message, 500);
  }
});

// Set Primary Domain
exports.setPrimaryDomain = asyncHandler(async (req, res) => {
  try {
    const doc = await domainService.setPrimaryDomain(req.tenantId, req.params.id);
    await audit(req, { action: 'PRIMARY_DOMAIN_SET', entity: 'TenantDomain', entityId: req.params.id });
    return sendSuccess(res, 'Primary domain updated', doc);
  } catch (e) {
    return sendError(res, e.message, e.status || 500);
  }
});

// Update Domain Settings (HTTPS, Redirects)
exports.updateDomainSettings = asyncHandler(async (req, res) => {
  try {
    const doc = await domainService.updateDomainSettings(req.tenantId, req.params.id, req.body);
    await audit(req, { action: 'DOMAIN_SETTINGS_UPDATED', entity: 'TenantDomain', entityId: req.params.id });
    return sendSuccess(res, 'Domain settings updated', doc);
  } catch (e) {
    return sendError(res, e.message, e.status || 500);
  }
});

// Refresh DNS manually
exports.refreshDns = asyncHandler(async (req, res) => {
  try {
    const result = await domainService.refreshDns(req.tenantId, req.params.id);
    return sendSuccess(res, 'DNS refreshed', result);
  } catch (e) {
    return sendError(res, e.message, e.status || 500);
  }
});

// System status (tenant-facing subset of monitoring — no platform internals).
exports.systemStatus = asyncHandler(async (req, res) => {
  const integrations = monitoringService.integrationConfigured();
  const mongo = await monitoringService.mongoStatus();
  return sendSuccess(res, 'System status', {
    api: 'operational',
    database: mongo.connected ? 'operational' : 'down',
    integrations: Object.fromEntries(Object.entries(integrations).map(([k, v]) => [k, v.configured ? 'configured' : 'not_configured'])),
    timestamp: new Date(),
  });
});

// Backup status (read-only: latest backup info for the platform).
exports.backupStatus = asyncHandler(async (req, res) => {
  const [latest] = await backupService.list({ limit: 1 });
  return sendSuccess(res, 'Backup status', latest ? { lastBackupAt: latest.completedAt, status: latest.status, documentCount: latest.documentCount } : { lastBackupAt: null });
});
