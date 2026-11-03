#!/bin/sh
# Mint a token for the read API: a JWT signed with HS256 under the Worker's
# API_TOKEN_SECRET, as the `Reader` actor verifies it.
#
#   API_TOKEN_SECRET=… scripts/token.sh <reader-name> [lifetime-seconds]
#
# The reader name becomes the token's `sub`, which the service logs on each
# read. The lifetime is a positive whole number of seconds (default 30 days);
# the Worker refuses an expired token.
#
#   curl -H "Authorization: Bearer $(API_TOKEN_SECRET=… scripts/token.sh me)" \
#     https://github-hooks.<subdomain>.workers.dev/activity
#
# The secret is read from the environment and the HMAC is computed by Node, so
# the secret never appears in a process's arguments (which `ps` shows to every
# user on the machine). TOKEN_ISSUED_AT (Unix seconds) backdates the token; the
# smoke test uses it to mint an expired one.
set -eu

usage() { echo "usage: API_TOKEN_SECRET=… scripts/token.sh <reader-name> [lifetime-seconds]" >&2; exit 2; }

name=${1:-}
lifetime=${2:-2592000}
[ -n "$name" ] || usage
[ -n "${API_TOKEN_SECRET:-}" ] || { echo "token.sh: set API_TOKEN_SECRET to the secret the Worker uses" >&2; exit 2; }

case $name in
  *[!A-Za-z0-9._@-]*) echo "token.sh: a reader name may use letters, digits and . _ @ - only" >&2; exit 2 ;;
esac
case $lifetime in
  ''|*[!0-9]*|0|0*) echo "token.sh: the lifetime must be a positive whole number of seconds, not '$lifetime'" >&2; exit 2 ;;
esac
issued=${TOKEN_ISSUED_AT:-$(date +%s)}
case $issued in
  ''|*[!0-9]*) echo "token.sh: TOKEN_ISSUED_AT must be Unix seconds" >&2; exit 2 ;;
esac

SUB=$name IAT=$issued EXP=$((issued + lifetime)) node -e '
const { createHmac } = require("node:crypto");
const b64 = (s) => Buffer.from(s).toString("base64url");
const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const body = b64(JSON.stringify({ sub: process.env.SUB, iat: Number(process.env.IAT), exp: Number(process.env.EXP) }));
const sig = createHmac("sha256", process.env.API_TOKEN_SECRET).update(`${head}.${body}`).digest("base64url");
console.log(`${head}.${body}.${sig}`);
'
