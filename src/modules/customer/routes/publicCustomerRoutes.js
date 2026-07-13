const express = require('express');
const router = express.Router();
const c = require('../controllers/publicController');

// All PUBLIC (no auth). Mounted at /api/public.
router.get('/knowledge', c.knowledgeList);
router.get('/knowledge/categories', c.knowledgeCategories);
router.get('/knowledge/:slug', c.knowledgeGet);
router.get('/announcements', c.announcements);
router.get('/release-notes', c.releaseNotes);
router.get('/status', c.status);

module.exports = router;
