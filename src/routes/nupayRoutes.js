const express = require('express');
const router = express.Router();
const { handleTT1Callback } = require('../controllers/nupayController');

router.post('/tt1/callback', handleTT1Callback);

module.exports = router;
