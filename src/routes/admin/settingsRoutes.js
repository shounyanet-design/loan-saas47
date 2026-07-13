const express = require('express');
const router = express.Router();
const {
  getSettings,
  updateGeneralSettings,
  updateEligibilityRules,
  updateDocumentRules,
  updateBulkSettings,
  resetSettings,
  calculateLivePreview
} = require('../../controllers/admin/settingsController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

// Protect all settings endpoints (Admin Only)
router.use(protect);
router.use(authorize('admin'));

router.get('/', getSettings);
router.put('/general', updateGeneralSettings);
router.put('/eligibility', updateEligibilityRules);
router.put('/document-rules', updateDocumentRules);
router.put('/bulk', updateBulkSettings);
router.post('/reset', resetSettings);
router.post('/live-preview', calculateLivePreview);

module.exports = router;
