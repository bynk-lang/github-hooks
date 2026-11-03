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
| 1 | Receive, verify and record every delivery | **this** |
| 2 | Read API over recorded activity, daily digest, retention | planned |
| 3 | Act on events through the App's installation token | planned |

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
`tests/seam.bynk` runs the deployable Worker itself, so the generated signature
check sees real signed, unsigned and forged requests.

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

## Deploy

[docs/github-app.md](docs/github-app.md) walks through the whole set-up in
order: choose a webhook secret, deploy the Worker with it, then register and
install the GitHub App. The deploy itself is:

```sh
npx wrangler login                    # or set CLOUDFLARE_API_TOKEN
printf 'APP_WEBHOOK_SECRET=%s\n' "<the App's webhook secret>" > .secrets.env
bynk deploy --secrets-file .secrets.env
```

The first deploy creates the `github-hooks-deliveries` D1 database, applies the
migrations, sets the secret and pushes the Worker. Commit the
`bynk.deploy.lock` it writes. Check the result with
`scripts/smoke.sh https://github-hooks.<subdomain>.workers.dev "<secret>"`;
the smoke rows are recorded like any other delivery.

## Layout

```text
src/github/events.bynk   commons github.events: payload types and pure decoding
src/github/hooks.bynk    context github.hooks: the Worker (actor, D1, routes)
migrations/              D1 schema, applied in tests, by bynk dev and by bynk deploy
tests/                   unit, integration and system suites
scripts/smoke.sh         signed requests against a running Worker
.github/actions/         CI's Bynk install, pinned by version and SHA-256
docs/github-app.md       registering and installing the GitHub App
```

## Licence

Dual-licensed under either of [MIT](LICENSE-MIT) or
[Apache-2.0](LICENSE-APACHE), at your option, like Bynk itself.
