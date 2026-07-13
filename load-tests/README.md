# Load Testing (k6)

Production load tests for the Point.47 LMS backend. **Read-only / non-mutating** —
safe to run against staging.

## Prerequisites
- [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) installed (`brew install k6`)
- A reachable backend (staging recommended, never production without sign-off)

## Scenarios
| SCENARIO | Peak VUs | Shape |
|----------|----------|-------|
| `load_100`  | 100  | 30s ramp · 1m hold · 20s down |
| `load_250`  | 250  | 45s ramp · 2m hold · 30s down |
| `load_500`  | 500  | 1m ramp · 3m hold · 30s down |
| `load_1000` | 1000 | 2m ramp · 5m hold · 1m down |

## Run
```bash
BASE=https://staging.point47.com
for s in load_100 load_250 load_500 load_1000; do
  k6 run -e BASE_URL=$BASE -e SCENARIO=$s \
    --summary-export=load-tests/results/$s.json \
    load-tests/loadtest.js
done
```
Authenticated read path (optional):
```bash
k6 run -e BASE_URL=$BASE -e SCENARIO=load_250 \
  -e AUTH_TOKEN=<jwt> -e READ_PATH=/api/admin/loan-applications \
  load-tests/loadtest.js
```

## Thresholds (build fails if breached)
- `http_req_failed` < 1%
- `http_req_duration` p95 < 800ms, p99 < 2s

## What to measure alongside the run
- **App:** scrape `GET /metrics` during the test (latency histogram, request rate).
- **CPU/memory:** container/host metrics or `process_resident_memory_bytes` &
  `process_cpu_seconds_total` from `/metrics`.
- **Mongo:** `mongo_ping_ms` / Atlas metrics; watch for connection-pool saturation.
- **Queues:** `queue_jobs{status="queued"}` depth from `/metrics`.

## Reporting
`--summary-export` writes per-scenario JSON to `load-tests/results/`. Capture p50/p95/p99,
throughput (reqs/s), and error rate into the production readiness report.

> **NOT VERIFIED in the build environment** — k6 is not installed here and there is
> no running server/cluster. These scripts are validated for structure only; run
> them against staging to produce real numbers.
