const tenantContext = require('../../../tenancy/tenantContext');

/**
 * Centralized logging (Part 7). Writes structured entries to the capped
 * SystemLog collection AND mirrors to console. Never throws into the caller.
 */
function log(category, level, message, meta = {}) {
  // Console mirror (always).
  const line = `[${category}/${level}] ${message}`;
  if (level === 'error') console.error(line); else if (level === 'warn') console.warn(line); else console.log(line);

  // Persist (best-effort, async, fire-and-forget).
  (async () => {
    try {
      const SystemLog = require('../models/SystemLog');
      await tenantContext.runAsSystem(() => SystemLog.create({
        category, level, message,
        tenantId: meta.tenantId, actor: meta.actor, ip: meta.ip,
        meta: stripReserved(meta), at: new Date(),
      }));
    } catch (_) { /* logging must never break the app */ }
  })();
}

function stripReserved(meta) {
  const { tenantId, actor, ip, ...rest } = meta || {};
  return rest;
}

// Convenience level helpers.
const make = (level) => (category, message, meta) => log(category, level, message, meta);

/** Query logs (platform). */
async function query({ category, level, limit = 100, skip = 0 } = {}) {
  const SystemLog = require('../models/SystemLog');
  const filter = {};
  if (category) filter.category = category;
  if (level) filter.level = level;
  return tenantContext.runAsSystem(() => SystemLog.find(filter).sort({ at: -1 }).skip(skip).limit(limit).lean());
}

module.exports = {
  log,
  debug: make('debug'),
  info: make('info'),
  warn: make('warn'),
  error: make('error'),
  query,
};
