const jwt = require('jsonwebtoken');

const generateToken = (id, role, tenantId) => {
  const payload = { id, role };
  // Include tenantId when available. Older callers that omit it still produce
  // a valid token; tenant is then resolved from the DB in the auth middleware.
  if (tenantId) payload.tenantId = String(tenantId);
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

module.exports = generateToken;
