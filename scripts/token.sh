#!/bin/sh
# Mint a token for the read API: a JWT signed with HS256 under the Worker's
# API_TOKEN_SECRET, as the `Reader` actor verifies it.
#
#   API_TOKEN_SECRET=… scripts/token.sh <reader-name> [lifetime-seconds]
#
# The reader name becomes the token's `sub`, which the service logs on each
# read. The lifetime defaults to 30 days; the Worker refuses an expired token.
#
#   curl -H "Authorization: Bearer $(API_TOKEN_SECRET=… scripts/token.sh me)" \
#     https://github-hooks.<subdomain>.workers.dev/activity
set -eu

name=${1:?usage: scripts/token.sh <reader-name> [lifetime-seconds]}
lifetime=${2:-2592000}
secret=${API_TOKEN_SECRET:?set API_TOKEN_SECRET to the secret the Worker uses}

case $name in
  *[!A-Za-z0-9._@-]*) echo "token.sh: reader name may use letters, digits and . _ @ - only" >&2; exit 2 ;;
esac

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

now=$(date +%s)
header=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
payload=$(printf '{"sub":"%s","iat":%d,"exp":%d}' "$name" "$now" "$((now + lifetime))" | b64url)
signature=$(printf '%s' "$header.$payload" | openssl dgst -sha256 -hmac "$secret" -binary | b64url)

printf '%s.%s.%s\n' "$header" "$payload" "$signature"
