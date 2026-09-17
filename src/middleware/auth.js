/**
 * Auth Middleware
 *
 * This module re-exports the shared authentication middleware from
 * `src/middlewares/authMiddleware.js` so that routes importing from
 * `../../middleware/auth` (singular) resolve correctly, keeping a single
 * source of truth for JWT/session validation logic.
 */

const { protect } = require('../middlewares/authMiddleware');

module.exports = {
  protect,
  auth: protect,
  authMiddleware: protect
};
