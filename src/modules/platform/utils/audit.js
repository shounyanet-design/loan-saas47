const PlatformAuditLog = require('../models/PlatformAuditLog');

/**
 * Record a Super Admin action. Never throws into the request path — an audit
 * failure must not break the operation, but it is logged to the console.
 */
async function recordAudit(req, { action, entity, entityId, oldValues, newValues }) {
  try {
    await PlatformAuditLog.create({
      platformUserId: req.platformUser && req.platformUser._id,
      platformUserEmail: req.platformUser && req.platformUser.email,
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip,
      userAgent: req.headers['user-agent'],
      action,
      entity,
      entityId: entityId != null ? String(entityId) : undefined,
      oldValues,
      newValues,
    });
  } catch (err) {
    console.error('[audit] failed to record action', action, err.message);
  }
}

module.exports = { recordAudit };
