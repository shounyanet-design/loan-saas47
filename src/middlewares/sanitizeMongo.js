/**
 * NoSQL-injection guard (Express 5 safe).
 *
 * Recursively removes keys that begin with `$` (Mongo operators) or contain `.`
 * (dotted-path traversal) from request payloads. This neutralises operator
 * injection such as `{"email": {"$gt": ""}}` reaching a Mongoose query.
 *
 * Express 5 makes `req.query` a read-only getter, so we only sanitise the
 * writable `req.body` and `req.params` in place. This is additive and does not
 * change the shape of legitimate payloads (real field names never start with
 * `$` or contain `.`).
 */
function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete value[key];
        continue;
      }
      value[key] = sanitizeValue(value[key]);
    }
  }
  return value;
}

module.exports = function sanitizeMongo(req, _res, next) {
  if (req.body) sanitizeValue(req.body);
  if (req.params) sanitizeValue(req.params);
  next();
};
