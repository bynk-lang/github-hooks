#!/bin/sh
# Send GitHub-shaped deliveries to a running github-hooks Worker and check the
# answers. Each is signed exactly as GitHub signs one: HMAC-SHA256 of the raw
# body under the webhook secret, sent as `X-Hub-Signature-256: sha256=<hex>`.
#
#   scripts/smoke.sh [base-url] [secret] [api-token-secret]
#
# Defaults suit `bynk dev -- --var APP_WEBHOOK_SECRET:dev-secret`. Given the
# read API's secret too, it also checks the read API's token handling.
set -eu

BASE=${1:-http://localhost:8787}
SECRET=${2:-dev-secret}
API_SECRET=${3:-}
DELIVERY="smoke-$(date +%s)-$$"
BODY='{"action":"opened","repository":{"full_name":"bynk-lang/github-hooks"},"sender":{"login":"octocat"},"organization":{"login":"bynk-lang"},"installation":{"id":1}}'

sign() {
  printf '%s' "$1" | openssl dgst -sha256 -hmac "$2" | sed 's/^.*= *//'
}

# post <expected-status> <description> <signature> [<delivery-id>]
# A request that gets no answer at all (connection refused, a mistyped URL)
# is reported as status 000, a failure like any other.
post() {
  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/github" \
    -H 'Content-Type: application/json' \
    -H 'X-GitHub-Event: issues' \
    -H "X-GitHub-Delivery: ${4:-$DELIVERY}" \
    -H "X-Hub-Signature-256: $3" \
    --data-binary "$BODY") || status=000
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

# get <expected-status> <description> <path> [<token>]
get() {
  if [ -n "${4:-}" ]; then
    status=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $4" "$BASE$3") || status=000
  else
    status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$3") || status=000
  fi
  if [ "$status" = "$1" ]; then
    echo "ok   $2 ($status)"
  else
    echo "FAIL $2: expected $1, got $status"
    failed=1
  fi
}

if [ -n "$API_SECRET" ]; then
  TOKEN=$(API_TOKEN_SECRET="$API_SECRET" "$(dirname "$0")/token.sh" smoke 300)
  WRONG=$(API_TOKEN_SECRET="not-the-secret" "$(dirname "$0")/token.sh" smoke 300)
  get 200 "a reader with a token lists activity" /activity "$TOKEN"
  get 200 "a reader reads today's digest" "/digest/$(date -u +%Y-%m-%d)" "$TOKEN"
  get 400 "a digest day that isn't YYYY-MM-DD is refused" /digest/yesterday "$TOKEN"
  get 401 "reading without a token is refused" /activity
  get 401 "a token signed with the wrong secret is refused" /activity "$WRONG"
fi

exit $failed
