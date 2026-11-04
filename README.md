# github-hooks

A GitHub App webhook receiver for the [`bynk-lang`](https://github.com/bynk-lang)
organisation, written in [Bynk](https://bynk-lang.org) and deployed as a
Cloudflare Worker.

It is two things at once:

- **A tool.** It records every event the organisation's GitHub App sends, so
  activity across the organisation can be tracked and, in later phases,
  answered with actions.
- **An example.** It shows what a real Bynk service looks like: a verified
  webhook boundary, typed decoding of untrusted JSON, a D1 database with
  migrations, and tests at every tier, with no hand-written crypto.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Receive, verify and record every delivery | released in [v0.1.0](CHANGELOG.md#010---2026-11-03) |
| 2 | Read API over recorded activity, daily digest, retention | read API and digest in progress ([#6](https://github.com/bynk-lang/github-hooks/issues/6)); retention after the load test |
| 3 | Act on events through the App's installation token | welcoming first-time contributors, in the sandbox ([docs](docs/github-app.md#7-let-the-app-act-phase-3)) |

## How it works

```text
GitHub App ──POST /github──▶ signature check ──▶ read headers + envelope ──▶ INSERT into D1
             X-Hub-Signature-256   (generated)       src/github/events.bynk      (delivery id is the key)
```

1. **Verify.** The `GitHub` actor in [`src/github/hooks.bynk`](src/github/hooks.bynk)
   declares `Signature(secret = "APP_WEBHOOK_SECRET", header = "X-Hub-Signature-256")`.
   The compiler generates the check: HMAC-SHA256 over the exact bytes received,
   compared in constant time, before the handler runs. Anything unsigned or
   forged gets `401`.
2. **Read.** The handler takes the raw body (`@raw`) and the request headers.
   [`github.events.read`](src/github/events.bynk) takes the event name from
   `X-GitHub-Event`, the delivery id from `X-GitHub-Delivery`, and decodes the
   fields every event shares (`action`, `repository`, `sender`, `organization`,
   `installation`). Every other key is ignored, so a large `push` decodes into
   a small record. A missing or empty header, or a body that isn't JSON, is `400`.
3. **Record.** One row per delivery in the `deliveries` table
   ([schema](migrations/github-hooks-deliveries/0001_create_deliveries.sql)).
   The delivery id is the primary key, and the insert is
   `ON CONFLICT (id) DO NOTHING`: when GitHub redelivers, nothing is inserted
   and the service answers `200 duplicate`. A new delivery is `202 recorded`.
   Any other database failure is logged and answered `500`, so GitHub marks the
   delivery failed and it can be redelivered.

GitHub signs no timestamp, so there is no replay window; the delivery-id key is
what makes a replay harmless.

Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Develop

You need [Bynk](https://github.com/bynk-lang/bynk#install) (`bynk doctor`
checks your setup) and Node 22.13 or later.

```sh
bynk check            # type-check
bynk fmt --check .    # formatting
bynk test             # every suite: unit, integration and system
```

`tests/events.bynk` tests the pure decoding. `tests/hooks.bynk` runs the
handler against an in-memory SQLite D1 with the schema applied.
`tests/read.bynk` covers the read API against seeded rows, and
`tests/activity.bynk` the digest. `tests/seam.bynk` runs the deployable Worker
itself, so the generated signature and token checks see real signed, unsigned,
forged and tokenless requests.

### Run it locally

```sh
bynk dev -- --var APP_WEBHOOK_SECRET:dev-secret
```

Then, in another terminal, send deliveries signed exactly as GitHub signs them:

```sh
scripts/smoke.sh                      # http://localhost:8787, secret dev-secret
```

```text
ok   a signed delivery is recorded (202)
ok   the same delivery again is a duplicate (200)
ok   a delivery signed with the wrong secret is refused (401)
ok   an unsigned delivery is refused (401)
```

`bynk dev` applies the migrations to a local database first.

To read what was recorded, also give the read API its secret:

```sh
bynk dev -- --var APP_WEBHOOK_SECRET:dev-secret --var API_TOKEN_SECRET:dev-api
```

then, in another terminal, mint a token and ask (see
[docs/read-api.md](docs/read-api.md)), or run the smoke test with both secrets:

```sh
curl -H "Authorization: Bearer $(API_TOKEN_SECRET=dev-api scripts/token.sh me)" \
  localhost:8787/activity
API_TOKEN_SECRET=dev-api scripts/smoke.sh
```

## Deploy

[docs/github-app.md](docs/github-app.md) walks through the whole set-up in
order: choose a webhook secret, deploy the Worker with it, then register and
install the GitHub App. The deploy itself is:

```sh
npx wrangler login                    # or set CLOUDFLARE_API_TOKEN
printf 'APP_WEBHOOK_SECRET=%s\n' "<the App's webhook secret>" > .secrets.env
printf 'API_TOKEN_SECRET=%s\n' "$(openssl rand -hex 32)" >> .secrets.env
bynk deploy --secrets-file .secrets.env
```

Both secrets are declared by the code's actors, so a deploy missing either one
fails, naming it.

The first deploy creates the `github-hooks-deliveries` D1 database, applies the
migrations, sets the secret and pushes the Worker. Commit the
`bynk.deploy.lock` it writes. Check the result with
`APP_WEBHOOK_SECRET=… API_TOKEN_SECRET=… scripts/smoke.sh https://github-hooks.<subdomain>.workers.dev`,
which also checks the read API's token handling; the smoke rows are recorded
like any other delivery. The scripts read secrets from the environment so they
never appear in a process's arguments.

## Layout

```text
src/github/events.bynk   commons github.events: payload types and pure decoding
src/github/activity.bynk commons github.activity: read API types and the digest
src/github/app.bynk      commons github.app: the App's JWT and GitHub API shapes
src/github/welcome.bynk  commons github.welcome: who is welcomed, and with what
src/github/hooks.bynk    context github.hooks: the Worker (actors, D1, KV, AppAuth, Bot, routes)
embeds/welcome.md        the welcome comment's text
migrations/              D1 schema, applied in tests, by bynk dev and by bynk deploy
tests/                   unit, integration and system suites
scripts/smoke.sh         signed requests against a running Worker
scripts/token.sh         mint a read API token
.github/actions/         CI's Bynk install, pinned by version and SHA-256
docs/github-app.md       registering and installing the GitHub App
docs/read-api.md         the read API: tokens, routes, what the digest counts
```

## Licence

Dual-licensed under either of [MIT](LICENSE-MIT) or
[Apache-2.0](LICENSE-APACHE), at your option, like Bynk itself.
