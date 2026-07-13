const jwt = require('jsonwebtoken');

/**
 * Platform (Super Admin) JWT.
 * The `scope: 'platform'` claim is what separates platform tokens from tenant
 * tokens — tenant middleware never accepts a platform token and vice-versa.
 */
function generatePlatformToken(platformUser) {
  return jwt.sign(
    { id: platformUser._id, role: platformUser.role, scope: 'platform' },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

module.exports = { generatePlatformToken };
