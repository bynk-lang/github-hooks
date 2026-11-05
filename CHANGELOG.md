# Changelog

All notable changes to github-hooks. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Built and tested with Bynk v0.508.4 (was v0.492.1). `Bot.react` now takes
  the `Delivery` itself instead of reading it again from its parts, now that a
  capability may take a commons type (bynk-lang/bynk#2886). The read API's
  token refusals are tested for forged and expired tokens too (`by Forged`,
  `by Expired`).
- **The read API's JSON is plain** (breaking for any client of the tagged
  form): an optional field is its value or `null`, so
  `"action": {"kind": "Some", "value": "opened"}` is now `"action": "opened"`
  and `"deleted": {"kind": "None"}` is `"deleted": null`
  (`json { options: plain }`, bynk-lang/bynk#2858). Bynk clients read both.
- A digest day is an `IsoDate`, so a date that doesn't exist (`2026-02-30`) is
  refused at the boundary like any other bad `:day`, not by the handler.
- The activity routes read with `select[Activity]`, which writes the column
  list from the row type.
- Read API tokens are minted with `bynk token Reader --sub <name>`;
  `scripts/token.sh` is gone. Its default lifetime was 30 days, `bynk token`'s
  is an hour: pass `--lifetime 30d` for the old one.

### Added

- Phase 4, step 1 (#20): every `workflow_run` delivery updates a
  `workflow_runs` row (migration `0004`), one per run attempt, with its
  workflow, branch, trigger, status, conclusion and queued/started/completed
  times, and whether the repository is public. A row only moves forward, so
  out-of-order deliveries can't undo a completed run. Kept indefinitely; the
  CI dashboard's metrics will read it. Data starts at deploy (no backfill).
- Retention (#6): an hourly `retention` cron service deletes deliveries older
  than 90 days, `workflow_run` progress (`requested`, `in_progress`) older than
  7 days, and `actions` older than 90 days, at most 5,000 rows per delete per
  run, oldest first (the `actions` delete scans: it has no index on `at`). `welcomed` is kept. Sized from the load test's ~3,200
  deliveries a day, two thirds of them workflow runs.
- Phase 3: the service acts as the GitHub App. It welcomes a first-time
  contributor's first issue or pull request with a comment (`embeds/welcome.md`),
  in the repositories `ACTION_REPOS` lists.
  - `AppAuth` signs an RS256 JWT with the App's private key (`APP_PRIVATE_KEY`,
    base64 PKCS#8; `APP_CLIENT_ID`) and exchanges it for an installation token,
    cached in the new `Tokens` KV namespace for 55 minutes.
  - `Bot` runs after the delivery is answered (`~>`), and records each action in
    the new `actions` table (migration `0003`), so a redelivery retries a
    failed action and repeats nothing that worked.
  - A person is welcomed at most once per repository (a `welcomed` table),
    since GitHub reports `FIRST_TIME_CONTRIBUTOR` on every pull request until
    one is merged.
  - A refused comment (`401`/`403`) drops the cached token and retries once
    with a fresh one; a claim left `started` for 10 minutes can be retried.
  - `WELCOME_ASSOCIATIONS` widens who is welcomed, for testing in a sandbox.
  - Setup is in `docs/github-app.md`, step 7.

- A read API, behind a `Reader` actor that accepts an HS256 JWT signed with
  the new `API_TOKEN_SECRET` (`scripts/token.sh` mints one):
  `GET /activity` and `GET /activity/:owner/:name` list the 50 most recent
  deliveries, and `GET /digest/:day` counts one UTC day's by repository, event
  and action. Each read is logged with the reader's name. See
  `docs/read-api.md`.
- Each delivery records GitHub's `deleted` flag (migration `0002`), read only
  from a `push`, so a push that deleted a branch or tag can be told apart; the
  digest leaves those out.

### Changed

- The digest's day handling uses `Instant.fromIso`, which already knows which
  dates exist, and queries the exact range from the day's first instant to the
  next day's (`start + 1.days`). This replaces a hand-written leap-year check
  and a string trick for the range's end; behaviour is unchanged.
- A read whose rows don't decode now logs why, from the `JsonError`'s kind,
  path and message (`StructuralMismatch at $[0].size: …`), not only that it
  failed.
- `scripts/smoke.sh` reads `APP_WEBHOOK_SECRET` (and, to check the read API,
  `API_TOKEN_SECRET`) from the environment instead of its arguments, and signs
  with Node, so no secret appears in a process's arguments.
- **Deploying needs `API_TOKEN_SECRET`** as well as `APP_WEBHOOK_SECRET`. A
  deploy without it fails, naming it.

### Fixed

- A comment or token GitHub refuses is logged with GitHub's own message as well
  as the status (`403 Resource not accessible by integration`), so a missing
  permission names itself. A `422` adds GitHub's `errors` details
  (`422 Validation Failed (Body is too long)`).
- A skipped welcome is logged with its reason (`welcome for <delivery>
  skipped: <login> is MEMBER, not in WELCOME_ASSOCIATIONS (…)`, a bot, no
  installation, a payload that did not decode). It was silent before, so a
  setting that hadn't reached the Worker looked like the service not running.
  Deliveries that were never candidates (other events and actions) stay quiet.
- docs/github-app.md explains that a redeploy keeps secrets already set, so
  changing `ACTION_REPOS` or `WELCOME_ASSOCIATIONS` needs `--force` or
  `wrangler secret put`, and removing one needs `wrangler secret delete`. A
  skipped delivery is retried by redelivering it.
- docs/github-app.md's deploy step now sets `API_TOKEN_SECRET` alongside the
  webhook secret, and step 7 no longer assumes the first `.secrets.env` was
  kept: secrets already on the Worker are kept by later deploys.
- `installation` and `installation_repositories` deliveries now record the
  organisation, from the installation's `account`. Those events have no
  top-level `organization`, so the `org` column was empty for them. No other
  event uses the installation's account, and an account without a `login` is
  recorded with an empty `org` rather than refused.

## [0.1.0] - 2026-11-03

Phase 1: receive, verify and record every delivery from the `bynk-lang` GitHub
App.

### Added

- `POST /github` receives the App's webhook deliveries. The compiler-generated
  `Signature` check verifies `X-Hub-Signature-256` (HMAC-SHA256 over the raw
  body, compared in constant time) before the handler runs, and answers `401`
  to anything unsigned or forged. The Worker reads the App's webhook secret
  from `APP_WEBHOOK_SECRET` (not a `GITHUB_` name, which GitHub Actions
  refuses for secrets).
- Each delivery is recorded as one row in the `github-hooks-deliveries` D1
  database: GitHub's delivery id and event name, plus the `action`,
  repository, sender, organisation and installation every event shares, and
  the payload's size.
- Redeliveries are harmless: the delivery id is the key, so a delivery GitHub
  sends again is answered `200 duplicate` and not recorded twice. Any other
  database failure is logged and answered `500`, so GitHub can redeliver it.
- A missing or empty `X-GitHub-Event` or `X-GitHub-Delivery` header, or a body
  that isn't JSON, is answered `400`.
- `GET /` describes the service.
- Tests at every tier: the pure decoding, the handler against an in-memory D1,
  and the deployable Worker's signature check. `scripts/smoke.sh` sends
  GitHub-signed deliveries to a running Worker, and CI runs both against a
  pinned, checksum-verified Bynk release (v0.492.1).
- `docs/github-app.md`: registering, permissioning and installing the App.

[Unreleased]: https://github.com/bynk-lang/github-hooks/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bynk-lang/github-hooks/releases/tag/v0.1.0
