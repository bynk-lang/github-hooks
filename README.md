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
| 2 | Read API over recorded activity, daily digest, retention | read API and digest live ([docs](docs/read-api.md)); retention hourly, 90 days ([#6](https://github.com/bynk-lang/github-hooks/issues/6)) |
| 3 | Act on events through the App's installation token | welcoming first-time contributors, live on `bynk-lang/bynk` ([docs](docs/github-app.md#7-let-the-app-act-phase-3)) |
| 4 | Public dashboard of repository health, CI first ([#20](https://github.com/bynk-lang/github-hooks/issues/20)) | run facts recorded; public CI metrics API ([docs](docs/ci-metrics.md)); the CI health page at `/`, updated live over WebSocket, with recent runs and daily trends; PR flow facts recorded and synced daily, a public PR flow API, and the PR flow page at `/prs`, live ([#26](https://github.com/bynk-lang/github-hooks/issues/26), [docs](docs/pr-flow.md)); release facts recorded, synced daily and matched to the pull requests they shipped, a public releases API, and the releases page at `/releases`, live ([#36](https://github.com/bynk-lang/github-hooks/issues/36), [docs](docs/releases.md)); job facts recorded for runner wait, a public runner-wait API computed hourly, and runner wait on the CI health page ([#42](https://github.com/bynk-lang/github-hooks/issues/42), [docs](docs/runners.md)); issue facts recorded and open issues synced daily, a public issue-response API, and the issues page at `/issues`, live ([#48](https://github.com/bynk-lang/github-hooks/issues/48), [docs](docs/issues.md)); maintainer sign-in through Cloudflare Access ([#53](https://github.com/bynk-lang/github-hooks/issues/53), [docs](docs/maintainers.md)) |

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

**Facts.** After answering, the service also extracts what the dashboard
(#20) reads. Each `workflow_run` delivery updates one row per run attempt in
`workflow_runs`
([schema](migrations/github-hooks-deliveries/0004_create_workflow_runs.sql)):
created by the first delivery, moved forward by later ones (`requested` <
`in_progress` < `completed`, then the newer `updated_at`), never back, so
deliveries arriving out of order are harmless. Each attempt has its own
`queued_at`, because GitHub's `created_at` belongs to the run and a re-run
keeps it. Those rows are kept for good; retention prunes only the raw
deliveries. Whether a repository is public lives in `repositories`, updated
from every delivery that says, and is decided when the dashboard reads: making
a repository private hides its whole history at once. Subscribing the App to
**Repository** events makes that immediate (`privatized`, `publicized`).

**Retention.** The `retention` cron service runs hourly (at :23). It deletes
deliveries older than 90 days, `workflow_run` deliveries that are only
`requested` or `in_progress` after 7 days (the `completed` one carries the
outcome, and runs are two thirds of all traffic), and `actions` older than 90
days. `welcomed` is kept, so a person is still welcomed only once. Each delete
takes at most 5,000 rows a run, oldest first. Sized from the load test: about
3,200 deliveries a day from `bynk-lang/bynk`, roughly 400–500 bytes a row in D1.
`workflow_job` deliveries, about 15,000 a day, are kept 7 days, and job facts
90 days before each day is rolled up for good ([docs](docs/runners.md)).

Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Develop

You need [Bynk](https://github.com/bynk-lang/bynk#install) at the version in
`BYNK_VERSION` (`bynk doctor` checks your setup) and Node 22.13 or later.

```sh
bynk check            # type-check
bynk fmt --check .    # formatting
bynk test             # every suite: unit, integration and system
```

`tests/events.bynk` tests the pure decoding. `tests/hooks.bynk` runs the
handler against an in-memory SQLite D1 with the schema applied.
`tests/read.bynk` covers the read API against seeded rows, and
`tests/activity.bynk` the digest, and `tests/retention.bynk` the hourly
retention job. `tests/seam.bynk` runs the deployable Worker
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
curl -H "Authorization: Bearer $(API_TOKEN_SECRET=dev-api bynk token Reader --sub me)" \
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
src/github/runs.bynk     commons github.runs: a workflow_run delivery as a workflow_runs row
src/github/pulls.bynk    commons github.pulls: pull_request and review deliveries as pull_requests and review rows
src/github/releases.bynk commons github.releases: release deliveries, and which pull requests a release shipped
src/github/jobs.bynk     commons github.jobs: a workflow_job delivery as a workflow_jobs row
src/github/metrics.bynk  commons github.metrics: the CI metrics API's query and answer types
src/github/hooks.bynk    context github.hooks: the Worker (actors, D1, KV, AppAuth, Bot, Facts, routes)
embeds/welcome.md        the welcome comment's text
embeds/dashboard.html    the CI health page served at /
embeds/prs.html          the PR flow page served at /prs
embeds/releases.html     the releases page served at /releases
embeds/issues.html       the issues page served at /issues
embeds/callback.html     the page Cloudflare Access returns a signing-in maintainer to
assets/                  their stylesheet and scripts, served content-hashed
fixtures/github/         recorded GitHub payloads the suites read (`fixture`)
migrations/              D1 schema, applied in tests, by bynk dev and by bynk deploy
tests/                   unit, integration and system suites
scripts/smoke.sh         signed requests against a running Worker
scripts/live.mjs         the live feed end to end (WebSocket), run by smoke.sh with SMOKE_LIVE=1
scripts/oidc.mjs         the maintainer sign-in's token check against a fake issuer, run by smoke.sh with SMOKE_OIDC=1
BYNK_VERSION             the Bynk release CI and local work use; the canary proposes moving it
.github/workflows/       CI (check, format, test; smoke), and the Bynk canary
docs/github-app.md       registering and installing the GitHub App
docs/read-api.md         the read API: tokens, routes, what the digest counts
docs/ci-metrics.md       the public CI metrics: routes, definitions, settings
docs/pr-flow.md          the PR flow: facts, the daily open-PR sync, routes
docs/releases.md         releases: facts, matching, the daily sync, routes, the page and live feed
docs/runners.md          runner wait: job facts, how long they're kept, routes, the page
docs/issues.md           issue response: issue facts, how they're kept, the daily sync, routes, the page and live feed
docs/maintainers.md      the maintainers view: Cloudflare Access sign-in, routes, settings
```

## The Bynk canary

This repository is enrolled in the bynk-lang
[canary](https://github.com/bynk-lang/.github/blob/main/canary/README.md). On
each Bynk release (and weekly), `.github/workflows/bynk-canary.yml` runs the
format check, type check, tests and a `bynk deploy` dry run, and the smoke and
live-feed checks (`.github/workflows/smoke.yml`), against that release:

- while a release fails them, a `canary` issue stays open here, and closes once
  a later one passes;
- when a newer release passes, a **Move to Bynk x.y.z** pull request moves
  `BYNK_VERSION`, with this repository's own CI run at the new version.

It needs this repository in `canary/repos.json` in bynk-lang/.github, and the
org's canary and bump GitHub Apps installed here.

## Licence

Dual-licensed under either of [MIT](LICENSE-MIT) or
[Apache-2.0](LICENSE-APACHE), at your option, like Bynk itself.
