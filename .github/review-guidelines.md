# Review guidelines for github-hooks

These are the maintainers' notes for reviewing a pull request here. The
repository is a GitHub App for the bynk-lang organisation. It runs on
Cloudflare Workers and is written in Bynk (`src/`, `tests/`). It's deployed
with `bynk deploy`, with D1 for storage, and calls GitHub's and Anthropic's
APIs.

Look for what would be wrong in production first, then what makes the code
harder to keep. Skip findings that `bynk fmt` or `bynk check` would already
report, since CI runs both.

## What matters most

- **Untrusted text.** Webhook payloads, issue and pull request text, comments,
  file contents and Claude's replies are anyone's text. Watch for:
  - anything the App posts to GitHub that skips the existing defusing. A
    mention (`@`) must not notify anyone, and HTML, images and links must be
    made safe the way `review.bynk` and the release notes already do;
  - that text reaching a system prompt, or anywhere it reads as an
    instruction rather than material;
  - SQL built from strings rather than bound parameters.
- **Webhooks.** A delivery's signature must be checked before it's trusted.
  Redeliveries happen, and Cloudflare Queues deliver at least once, so each
  handler must be idempotent: claim the work in D1 once and do nothing on a
  second claim. Answer GitHub quickly, and move slow work to a queue,
  `detach()` or a scheduled job.
- **Secrets.** No token, key or private value in code, fixtures, logs, test
  output or posted text. Installation tokens stay in the Worker.
- **The caps and the costs.** Each call to Claude is claimed against its
  daily caps before it's made, and recorded in `claude_calls`. A new path that
  calls Claude without both is blocking.
- **The App acts with care.** What Claude writes reaches GitHub only after a
  maintainer approves it in Mine (the proposals), unless the repository's
  settings opt in to posting directly, as `review` does. Flag a change that
  posts Claude's text without either, or that makes the App write to GitHub
  where it didn't before without saying so in the pull request.
- **Permissions.** A change that needs a new GitHub App permission or event
  subscription must say so in `docs/github-app.md`, as GitHub won't grant it
  until an owner accepts it.

## Bynk

- Prefer typed reads (`select[T]`) and named record types to hand-built JSON
  or maps.
- Results that can fail are `Result`. A failure from GitHub or Anthropic is
  either retried, recorded or reported. It's never dropped silently. Retry only
  on a transient failure (5xx, a rate limit or the network), never on a 4xx.
- Experimental Bynk modules must be listed under `[unstable] allow` in
  `bynk.toml`, with the comment there saying why.
- A tool output that needs a lot of memory may need `NODE_OPTIONS`; see
  `docs/deploy.md`.

## Tests

- Each change of behaviour comes with tests in `tests/`, against an in-memory
  D1 with the migrations applied, and with GitHub and Anthropic stubbed at the
  wire. Look for missing failure cases: a 4xx, a 5xx, an empty answer, a
  redelivery, and a boundary on each limit.
- The `github.hooks` suite is near Bynk's limit of 499 cases in one suite
  (bynk-lang/bynk#3639). A new test may extend an existing case rather than
  add one. Don't flag that as a smell.
- A test should state what it checks in its `---` doc comment, and its fixed
  time and data should be ones a reader can follow.

## Storage

- Schema changes are new numbered files in `migrations/github-hooks-deliveries/`.
  A migration that has already merged is never edited.
- A new table needs a retention rule in `retention.bynk`, or a reason in the
  pull request for keeping its rows.
- Times are stored as ISO-8601 text in UTC, as GitHub sends them, and days
  are UTC days.

## Deploy

- A new Worker secret or setting is passed in each place `deploy.yml` lists
  secrets, and is documented in `docs/deploy.md` with its default.
- A new Cloudflare resource (a queue, a binding) is described in
  `docs/deploy.md`, with the token permission it needs.

## Documentation and style

- A change a maintainer or a repository's owner would notice updates its page
  in `docs/` and adds a line under `[Unreleased]` in `CHANGELOG.md`. A new
  setting is documented in `docs/settings.md`.
- British English throughout, in code comments, docs and posted text
  ("organisation", "behaviour", "licence" as a noun). Dates in the docs are
  written as "16 November 2026".
- Comments and docs explain why something is done, in plain sentences. Issue
  and pull request numbers (`#129`) tie decisions to where they were taken.

## Severity here

- **Blocking:** a security or privacy hole, lost or corrupted data, a webhook
  handled twice or never, a cap or record skipped, a deploy that would fail,
  or a broken migration.
- **Should fix:** a missing test for changed behaviour, a failure handled
  wrongly, missing docs or CHANGELOG entry, or a clear simplification.
- **Nit:** wording, naming and small style points. Keep these few.
