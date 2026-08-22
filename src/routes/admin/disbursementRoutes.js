/**
 * Disbursement Routes
 * POST /api/admin/loans/:applicationId/disburse
 *
 * Gating:
 *  - protect: validates JWT, resolves tenantId
 *  - authorize('admin'): only admins may trigger disbursement
 *
 * Business logic is in disbursement.service.js (transactional).
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const { disburse } = require('../../modules/disbursement/controllers/disbursement.controller');

// POST /api/admin/loans/:applicationId/disburse
router.post('/:applicationId/disburse', protect, authorize('admin'), disburse);

module.exports = router;
