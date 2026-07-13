const express = require('express');
const { register } = require('./metrics');

const router = express.Router();

/**
 * GET /metrics — Prometheus scrape endpoint.
 *
 * Optionally protected: if METRICS_TOKEN is set, the scraper must send
 * `Authorization: Bearer <token>`. If unset, the endpoint is open (typical when
 * /metrics is only reachable on an internal network). Either way it is additive
 * and never touches the existing API surface.
 */
router.get('/', async (req, res) => {
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (provided !== token) return res.status(401).send('Unauthorized');
  }
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).send(`# metrics error: ${err.message}`);
  }
});

module.exports = router;
