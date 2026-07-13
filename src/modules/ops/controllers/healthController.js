const asyncHandler = require('../../../utils/asyncHandler');
const monitoringService = require('../services/monitoringService');

// Public, unauthenticated — for load balancers, Docker/K8s probes, uptime checks.
exports.live = asyncHandler(async (req, res) => res.status(200).json(await monitoringService.liveness()));
exports.ready = asyncHandler(async (req, res) => {
  const r = await monitoringService.readiness();
  res.status(r.ready ? 200 : 503).json(r);
});
exports.health = asyncHandler(async (req, res) => {
  const h = await monitoringService.health();
  res.status(h.status === 'down' ? 503 : 200).json(h);
});
