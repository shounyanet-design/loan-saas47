const jwt = require('jsonwebtoken');

/**
 * Generates a JWT token
 * @param {string} id - User ID
 * @param {string} role - User role
 * @param {string} [tenantId] - Tenant the user belongs to (optional)
 * @returns {string} Signed JWT token
 */
const generateToken = (id, role, tenantId) => {
  const payload = { id, role };
  if (tenantId) payload.tenantId = String(tenantId);
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

/**
 * Verifies a JWT token
 * @param {string} token - JWT token string
 * @returns {Object} Decoded payload
 */
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

module.exports = {
  generateToken,
  verifyToken,
};
