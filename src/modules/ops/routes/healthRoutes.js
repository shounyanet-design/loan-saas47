const express = require('express');
const router = express.Router();
const h = require('../controllers/healthController');

// Public probes for load balancers / Docker / K8s.
router.get('/', h.health);
router.get('/live', h.live);
router.get('/ready', h.ready);

module.exports = router;
