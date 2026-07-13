const PlatformAuditLog = require('../../platform/models/PlatformAuditLog');

/**
 * Append an audit entry from EITHER a platform (super admin) or a tenant user.
 * Never throws into the request path.
 */
async function audit(req, { action, entity, entityId, oldValues, newValues }) {
  try {
    const isPlatform = !!req.platformUser;
    await PlatformAuditLog.create({
      platformUserId: isPlatform ? req.platformUser._id : undefined,
      platformUserEmail: isPlatform ? req.platformUser.email : (req.user ? `tenant:${req.user.email}` : 'system'),
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip,
      userAgent: req.headers['user-agent'],
      action,
      entity,
      entityId: entityId != null ? String(entityId) : undefined,
      oldValues,
      newValues,
    });
  } catch (err) {
    console.error('[auditAny] failed', action, err.message);
  }
}

module.exports = { audit };
