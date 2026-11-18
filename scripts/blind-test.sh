#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
INPUT_CSV="${1:?Usage: scripts/blind-test.sh <pr-batch.csv> <amendment.json> [as-of-date] }"
AMENDMENT_FILE="${2:?Usage: scripts/blind-test.sh <pr-batch.csv> <amendment.json> [as-of-date] }"
AS_OF="${3:-2026-11-18}"
BATCH_ID="${BATCH_ID:-blind-test-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBMISSION_DIR="${ROOT_DIR}/submission"
mkdir -p "${SUBMISSION_DIR}"

npm run seed

curl --fail --silent --show-error \
  -H "X-User: blind-test" \
  -F "file=@${INPUT_CSV}" \
  "${BASE_URL}/api/process-batch?batchId=${BATCH_ID}"

curl --fail --silent --show-error \
  "${BASE_URL}/api/decisions/export?batchId=${BATCH_ID}" \
  > "${SUBMISSION_DIR}/run1_decisions.csv"

CHANGE_JSON="$(curl --fail --silent --show-error \
  -H "X-User: blind-test" \
  -F "document=@${AMENDMENT_FILE};type=application/json" \
  "${BASE_URL}/api/policies/propose")"
CHANGE_ID="$(printf '%s' "${CHANGE_JSON}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s)._id))")"

curl --fail --silent --show-error \
  -H "Content-Type: application/json" \
  -H "X-User: blind-test" \
  -d "{\"effectiveFrom\":\"${AS_OF}T00:00:00.000Z\"}" \
  "${BASE_URL}/api/policy-changes/${CHANGE_ID}/approve" \
  > "${SUBMISSION_DIR}/approved_policy_change.json"

curl --fail --silent --show-error \
  -H "X-User: blind-test" \
  -F "file=@${INPUT_CSV}" \
  "${BASE_URL}/api/process-batch?batchId=${BATCH_ID}-run2"

curl --fail --silent --show-error \
  "${BASE_URL}/api/decisions/export?batchId=${BATCH_ID}-run2" \
  > "${SUBMISSION_DIR}/run2_decisions.csv"

curl --fail --silent --show-error \
  "${BASE_URL}/api/suppliers/preferred?asOf=${AS_OF}&format=csv" \
  > "${SUBMISSION_DIR}/preferred_suppliers.csv"

printf 'Blind test exports written to %s\n' "${SUBMISSION_DIR}"
