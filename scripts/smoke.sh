#!/bin/sh
# Send GitHub-shaped deliveries to a running github-hooks Worker and check the
# answers. Each is signed exactly as GitHub signs one: HMAC-SHA256 of the raw
# body under the webhook secret, sent as `X-Hub-Signature-256: sha256=<hex>`.
#
#   [APP_WEBHOOK_SECRET=…] [API_TOKEN_SECRET=…] scripts/smoke.sh [base-url]
#
# The secrets come from the environment, under the names the Worker uses, so
# they never appear in a process's arguments. APP_WEBHOOK_SECRET defaults to
# `dev-secret`, to suit `bynk dev -- --var APP_WEBHOOK_SECRET:dev-secret`. With
# API_TOKEN_SECRET set, it also checks the read API's token handling, minting
# tokens with `bynk token Reader`.
set -eu

BASE=${1:-http://localhost:8787}
APP_WEBHOOK_SECRET=${APP_WEBHOOK_SECRET:-dev-secret}
PROJECT="$(dirname "$0")/.."
DELIVERY="smoke-$(date +%s)-$$"
BODY='{"action":"opened","repository":{"full_name":"bynk-lang/github-hooks"},"sender":{"login":"octocat"},"organization":{"login":"bynk-lang"},"installation":{"id":1}}'

# sign <body> <secret>: the hex HMAC-SHA256, computed by Node from the
# environment, never from arguments.
sign() {
  printf '%s' "$1" | KEY=$2 node -e '
    const { createHmac } = require("node:crypto");
    let data = "";
    process.stdin.on("data", (c) => (data += c)).on("end", () =>
      process.stdout.write(createHmac("sha256", process.env.KEY).update(data).digest("hex")));
  '
}

failed=0
check() {
  if [ "$2" = "$1" ]; then
    echo "ok   $3 ($2)"
  else
    echo "FAIL $3: expected $1, got $2"
    failed=1
  fi
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
  check "$1" "$status" "$2"
}

# get <expected-status> <description> <path> [<token>]
get() {
  if [ -n "${4:-}" ]; then
    status=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $4" "$BASE$3") || status=000
  else
    status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$3") || status=000
  fi
  check "$1" "$status" "$2"
}

GOOD="sha256=$(sign "$BODY" "$APP_WEBHOOK_SECRET")"
BAD="sha256=$(sign "$BODY" "not-the-secret")"

post 202 "a signed delivery is recorded" "$GOOD"
post 200 "the same delivery again is a duplicate" "$GOOD"
post 401 "a delivery signed with the wrong secret is refused" "$BAD" "$DELIVERY-forged"
post 401 "an unsigned delivery is refused" "" "$DELIVERY-unsigned"
get 200 "CI metrics are public" /metrics/ci
get 200 "what CI is running now is public" /metrics/ci/now
get 200 "CI history is public" "/metrics/ci/history?days=30"
get 400 "a CI history window other than 7, 30 or 90 days is refused" "/metrics/ci/history?days=14"
get 200 "PR flow is public" "/metrics/prs?days=30"
get 200 "open pull requests are public" /metrics/prs/open
get 200 "the PR flow page is public" /prs
get 400 "a PR flow window other than 7, 30 or 90 days is refused" "/metrics/prs?days=14"
get 200 "releases are public" "/metrics/releases?days=30"
get 200 "recent releases are public" /metrics/releases/recent
get 200 "the releases page is public" /releases
get 200 "the issues page is public" /issues
get 200 "runner waits are public" "/metrics/runners?days=30"
get 200 "jobs waiting now are public" /metrics/runners/now
get 400 "a runners window other than 7, 30 or 90 days is refused" "/metrics/runners?days=14"
get 200 "issue flow is public" "/metrics/issues?days=30"
get 200 "the open issue backlog is public" /metrics/issues/open
get 400 "an issues window other than 7, 30 or 90 days is refused" "/metrics/issues?days=14"
get 400 "a releases window other than 7, 30 or 90 days is refused" "/metrics/releases?days=14"
get 400 "a CI window longer than 90 days is refused" "/metrics/ci?days=91"
get 400 "a CI window other than 7, 30 or 90 days is refused" "/metrics/ci?days=14"

if [ -n "${API_TOKEN_SECRET:-}" ]; then
  # `bynk token` reads API_TOKEN_SECRET from the environment, as the Worker does.
  TOKEN=$(bynk token Reader --sub smoke --lifetime 5m --input "$PROJECT")
  WRONG=$(API_TOKEN_SECRET=not-the-secret bynk token Reader --sub smoke --input "$PROJECT")
  EXPIRED=$(bynk token Reader --sub smoke --expired --input "$PROJECT")
  get 200 "a reader with a token lists activity" /activity "$TOKEN"
  get 200 "a reader reads today's digest" "/digest/$(date -u +%Y-%m-%d)" "$TOKEN"
  # The delivery recorded above, as plain JSON: an Option is its value or null.
  shape=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/activity" | DELIVERY=$DELIVERY node -e '
    let data = "";
    process.stdin.on("data", (c) => (data += c)).on("end", () => {
      try {
        const row = JSON.parse(data).find((r) => r.id === process.env.DELIVERY);
        process.stdout.write(row && row.action === "opened" && row.deleted === null ? "plain" : "tagged");
      } catch { process.stdout.write("unreadable"); }
    });
  ') || shape=none
  check plain "$shape" "activity is plain JSON (action is a string, deleted is null)"
  get 400 "a digest day that isn't YYYY-MM-DD is refused" /digest/yesterday "$TOKEN"
  get 400 "a digest day that doesn't exist is refused" /digest/2026-02-30 "$TOKEN"
  get 401 "reading without a token is refused" /activity
  get 401 "a token signed with the wrong secret is refused" /activity "$WRONG"
  get 401 "an expired token is refused" /activity "$EXPIRED"
fi

if [ "${SMOKE_LIVE:-}" = 1 ]; then
  APP_WEBHOOK_SECRET=$APP_WEBHOOK_SECRET node "$(dirname "$0")/live.mjs" "$BASE" || failed=1
fi

exit $failed
