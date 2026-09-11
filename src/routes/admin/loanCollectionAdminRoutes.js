const express = require('express');
const router = express.Router();
const {
  getCollectionAttempts,
  getCollectionAttemptById,
  getCollectionDashboardStats,
  initiateBorrowerCardAuth
} = require('../../controllers/admin/loanCollectionAdminController');
const { protect } = require('../../middleware/auth');

router.use(protect);

router.get('/stats', getCollectionDashboardStats);
router.get('/dashboard', getCollectionDashboardStats);
router.get('/', getCollectionAttempts);
router.get('/:id', getCollectionAttemptById);
router.post('/borrower/:borrowerId/authorize-card', initiateBorrowerCardAuth);

module.exports = router;
