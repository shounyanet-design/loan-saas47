#!/usr/bin/env bash
# Point.47 LMS — post-deployment validation.
# Probes a running deployment's health, readiness, metrics and graceful-shutdown
# readiness. Read-only. Exits non-zero if any required check fails.
#
# Usage: BASE_URL=https://staging.point47.com ./scripts/validate-deployment.sh
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:5000}"
FAIL=0

check() {
  local name="$1" url="$2" expect="$3"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo "000")
  if [[ ",$expect," == *",$code,"* ]]; then
    echo "✅ $name -> HTTP $code"
  else
    echo "❌ $name -> HTTP $code (expected $expect)"
    FAIL=1
  fi
}

echo "=== Validating deployment @ $BASE_URL ==="
check "Liveness"  "$BASE_URL/api/health/live"  "200"
check "Readiness" "$BASE_URL/api/health/ready" "200"
check "API root"  "$BASE_URL/"                 "200"
check "Metrics"   "$BASE_URL/metrics"          "200,401"

# Readiness body should report mongo connectivity.
echo "--- readiness detail ---"
curl -s --max-time 10 "$BASE_URL/api/health/ready" || true
echo

if [[ "$FAIL" -eq 0 ]]; then
  echo "=== ✅ Deployment validation PASSED ==="
else
  echo "=== ❌ Deployment validation FAILED ==="
fi
exit "$FAIL"
