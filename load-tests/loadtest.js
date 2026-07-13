/* eslint-disable */
// Point.47 LMS — k6 load test.
// Reusable across the 100 / 250 / 500 / 1000 user scenarios via the SCENARIO env var.
//
// Run examples (see ./README.md):
//   k6 run -e BASE_URL=https://staging.point47.com -e SCENARIO=load_100  load-tests/loadtest.js
//   k6 run -e BASE_URL=https://staging.point47.com -e SCENARIO=load_1000 load-tests/loadtest.js
//
// Optionally exercise an authenticated read path by supplying a token:
//   -e AUTH_TOKEN=eyJhbGci...  -e READ_PATH=/api/admin/loan-applications
//
// This script is intentionally read-only / non-mutating so it is safe to point
// at a staging environment. It does NOT create borrowers, loans, or payments.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const READ_PATH = __ENV.READ_PATH || '';
const SCENARIO = __ENV.SCENARIO || 'load_100';

export const errorRate = new Rate('errors');
export const readyLatency = new Trend('ready_latency_ms', true);

// One ramped scenario per target concurrency. Each ramps up, holds, ramps down.
const SCENARIOS = {
  load_100:  { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '30s', target: 100 },  { duration: '1m', target: 100 },  { duration: '20s', target: 0 }] },
  load_250:  { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '45s', target: 250 },  { duration: '2m', target: 250 },  { duration: '30s', target: 0 }] },
  load_500:  { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '1m',  target: 500 },  { duration: '3m', target: 500 },  { duration: '30s', target: 0 }] },
  load_1000: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '2m',  target: 1000 }, { duration: '5m', target: 1000 }, { duration: '1m',  target: 0 }] },
};

export const options = {
  scenarios: { [SCENARIO]: SCENARIOS[SCENARIO] || SCENARIOS.load_100 },
  thresholds: {
    http_req_failed: ['rate<0.01'],          // < 1% errors
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    errors: ['rate<0.01'],
  },
};

export default function () {
  // 1) Liveness (no DB dependency) — pure process/throughput probe.
  let res = http.get(`${BASE_URL}/api/health/live`);
  check(res, { 'live 200': (r) => r.status === 200 }) || errorRate.add(1);

  // 2) Readiness (hits Mongo) — measures DB responsiveness under load.
  res = http.get(`${BASE_URL}/api/health/ready`);
  readyLatency.add(res.timings.duration);
  check(res, { 'ready 200/503': (r) => r.status === 200 || r.status === 503 }) || errorRate.add(1);

  // 3) Optional authenticated read path (e.g. a paginated list endpoint).
  if (AUTH_TOKEN && READ_PATH) {
    res = http.get(`${BASE_URL}${READ_PATH}`, { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } });
    check(res, { 'read 2xx': (r) => r.status >= 200 && r.status < 300 }) || errorRate.add(1);
  }

  sleep(1);
}

// Summary is written to stdout; pipe k6's --summary-export for a JSON report:
//   k6 run --summary-export=load-tests/results/$SCENARIO.json ...
