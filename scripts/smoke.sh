#!/bin/sh
# Send GitHub-shaped deliveries to a running github-hooks Worker and check the
# answers. Each is signed exactly as GitHub signs one: HMAC-SHA256 of the raw
# body under the webhook secret, sent as `X-Hub-Signature-256: sha256=<hex>`.
#
#   scripts/smoke.sh [base-url] [secret]
#
# Defaults suit `bynk dev -- --var GITHUB_WEBHOOK_SECRET:dev-secret`.
set -eu

BASE=${1:-http://localhost:8787}
SECRET=${2:-dev-secret}
DELIVERY="smoke-$(date +%s)-$$"
BODY='{"action":"opened","repository":{"full_name":"bynk-lang/github-hooks"},"sender":{"login":"octocat"},"organization":{"login":"bynk-lang"},"installation":{"id":1}}'

sign() {
  printf '%s' "$1" | openssl dgst -sha256 -hmac "$2" | sed 's/^.*= *//'
}

# post <expected-status> <description> <signature> [<delivery-id>]
post() {
  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/github" \
    -H 'Content-Type: application/json' \
    -H 'X-GitHub-Event: issues' \
    -H "X-GitHub-Delivery: ${4:-$DELIVERY}" \
    -H "X-Hub-Signature-256: $3" \
    --data-binary "$BODY")
  if [ "$status" = "$1" ]; then
    echo "ok   $2 ($status)"
  else
    echo "FAIL $2: expected $1, got $status"
    failed=1
  fi
}

failed=0
GOOD="sha256=$(sign "$BODY" "$SECRET")"
BAD="sha256=$(sign "$BODY" "not-the-secret")"

post 202 "a signed delivery is recorded" "$GOOD"
post 200 "the same delivery again is a duplicate" "$GOOD"
post 401 "a delivery signed with the wrong secret is refused" "$BAD" "$DELIVERY-forged"
post 401 "an unsigned delivery is refused" "" "$DELIVERY-unsigned"

exit $failed
