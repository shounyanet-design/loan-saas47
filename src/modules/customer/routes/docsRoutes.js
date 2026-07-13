const express = require('express');
const router = express.Router();
const c = require('../controllers/publicController');

// Developer portal docs (public). Mounted at /api/docs.
router.get('/openapi.json', c.openapi);
router.get('/postman.json', c.postman);

module.exports = router;
