# Changelog

All notable changes to github-hooks. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A live board for maintainers (#68, step 1). Signed in, a page also joins a
  `maintainers` board that carries the changes the public board leaves out
  (private repositories, and those in `DASHBOARD_EXCLUDE`), so they're live
  too and the page polls as the public one does. Each change goes to one
  board: a hidden one purges nothing at the edge and moves the maintainers'
  shared figures on instead (migration `0021`, `hidden_changes`), at most once
  per its purge slot's gap, as an edge purge is. A page joins
  through `POST /maintainers/live`, which makes every maintainer check and has
  the board expect its random client id for a minute; the board closes any
  socket it doesn't expect, a login's sockets when they sign out, and every
  maintainer's socket after an hour, so the page asks again.

### Changed

- `src/github/hooks.bynk` (5,400 lines) is split into 25 files under
  `src/github/hooks/`, one per part of the Worker, each opening
  `context github.hooks`, which Bynk joins into one context. Nothing else
  changes: every declaration moved as it was, the tests and the deploy plan
  are the same.
- `docs/deploy.md` says what the lock holds and when it changes: also whenever
  a page's script or styles change, so most releases leave a lock to commit.
  It says how to commit a tag deploy's lock, and that the lock from the last
  local deploy must be committed before the first deploy from CI.

## [0.2.0] - 2026-11-07

Phases 2 to 4: the read API, daily digest and retention; the App acting on
events (welcoming first-time contributors); and the public dashboard of
repository health, with CI, pull request flow, releases, runner wait and issue
response, and the maintainers' view behind GitHub sign-in. Deploys now run from
GitHub Actions.

### Added

- Deploys from GitHub Actions (#62). `.github/workflows/deploy.yml` deploys a
  `v*` tag on `main` to production with `bynk-deploy`, once the checks and
  smoke pass on it, then checks that the live Worker answers. Pull requests get
  a dry-run plan; a manual run deploys `main`, can only check which secrets are
  set, or can overwrite them after a rotation. The Worker's secrets are Actions
  secrets in a `production` environment, one per name; a name whose Actions
  secret isn't set is left out rather than passed empty. A changed
  `bynk.deploy.lock` comes back as a pull request, or as an artifact for a
  tag's deploy. See `docs/deploy.md`.
- Phase 4, slice 6, step 5 (#53): sessions and actions.
  - **Server-side sign-out:** a maintainer token's subject is
    `login:version`, checked against `maintainer_sessions` (migration
    `0018`) on every maintainer request. A read that fails refuses with
    `503`. `POST /maintainers/signout` moves the login on, ending every
    earlier token on every device. The page's *Sign out* calls it, and says
    so if it couldn't.
  - **Re-running failed jobs:** `POST /maintainers/actions/rerun` asks GitHub
    to re-run a run's failed jobs, as the App, for the latest attempt of a
    run that failed, once: the attempt is claimed before GitHub is asked.
    Every outcome is kept in `maintainer_actions`. It's
    limited to 10 a minute per login (`ActionLimit`).
  - **The page:** signed in, each workflow's trend panel on CI health lists
    its recent failed runs with a *Re-run failed jobs* button, confirmed
    before it's sent.
  - **Permission:** re-runs need the App's **Actions: Read and write**.
- Phase 4, slice 6, step 4 (#53): the per-person view.
  - **`GET /maintainers/mine`:** what is the signed-in maintainer's to act
    on, across every repository: their open pull requests with stage and CI
    on the head commit, pull requests waiting on their review, their open
    issues (stale first), and their merges waiting to ship.
  - **Recorded** (migration `0017`): each pull request's head commit
    (`head_sha`), and whose review it waits on
    (`pull_request_review_requests`). A strictly newer delivery replaces the
    set, `review_requested` and `review_request_removed` add or remove one,
    and a submitted review takes its reviewer's request off.
  - **The pages:** each signed-in page shows its own part under *Yours*. CI
    health shows failing pull requests; PR flow shows open ones and review
    requests; issues and releases show theirs.
- Phase 4, slice 6, step 3 (#53): the signed-in pages.
  - **Figures:** signed in, the four dashboards read the maintainer twins
    (`window.bynkMetrics` in `signin.js`, which now loads first), so they
    include private and `DASHBOARD_EXCLUDE`'d repositories. Signed out,
    nothing changes.
  - **Marks:** a repository only maintainers see is marked **private** or
    **not public** beside its name, from `GET /maintainers/repositories`. Each
    page's subtitle says it covers every repository.
  - **Freshness:** signed in, polling no longer slows while the live feed is
    up, as the feed carries only public repositories, and the freshness line
    says the rest are polled.
  - **Shared figures:** each twin's answer is kept in KV for 60 seconds
    (`sharedFigures`), keyed by route, query and the route's last edge
    purge, so every signed-in tab shares one D1 read a minute, and a live
    change that purges the public routes reaches maintainers' pages too. It's
    asked only past the membership check.
  - **A refused token** signs the page out, back to the public figures.
- Phase 4, slice 6, step 2 (#53): the maintainers' figures.
  - **Eleven twins:** each public metrics route has a maintainer twin,
    `POST /maintainers/metrics/…`, with the same figures over every
    repository, private and `DASHBOARD_EXCLUDE`'d ones included. The request
    is the public query string as a JSON body. They're `POST` because Bynk's
    generated test code doesn't compile for a `Bearer` route with a query
    string in a project with a `system`-tier suite (bynk-lang/bynk#3024).
  - **One query each:** each route's body is now a function both routes call.
    A maintainer's call passes `*` as the exclusion list, which the SQL reads
    as "private repositories too", or, for the CI routes, a flag.
  - **`GET /maintainers/repositories`:** every repository, marked public or
    not and excluded or not, for the signed-in pages to mark.
  - **Access:** every maintainer request rechecks membership (`forMaintainer`,
    a kept answer first), within a per-login limit of 60 a minute
    (`MaintainerLimit`), as nothing is cached: no `@cache`, so `no-store` or a
    `POST`.
  - **Testing:** each metrics suite compares every public route with its twin
    on one seed, and smoke checks the twins refuse a missing or reader's
    token.
- Phase 4, slice 6, step 1 (#53): maintainer sign-in with GitHub.
  - **Sign-in:** maintainers sign in through the GitHub App's user
    authorisation, with PKCE. The Worker exchanges the code with the App's
    client secret (`POST /maintainers/token`), reads the login from GitHub's
    `GET /user`, and issues its own token once GitHub confirms, asked fresh,
    that they belong to the organisation. GitHub's user token is revoked
    straight after, and never kept.
  - **The actor:** a `Maintainer` actor (Bynk's `Bearer`, signed with the new
    `MAINTAINER_TOKEN_SECRET`) verifies that token, whose subject is the
    GitHub login. `bynk token Maintainer` mints one for testing.
  - **`GET /maintainers/me`:** answers with the person's GitHub login, once
    GitHub confirms they still belong. A membership answer kept from the last
    day is used first; otherwise the installation to ask with is found per
    repository, through the repository index.
  - **The code exchange:** the redirect URI must be the callback on the
    origin the request came to.
  - **The pages:** every dashboard gains a sign-in link, and
    `/maintainers/callback` finishes the sign-in.
  - **Settings:** `APP_CLIENT_SECRET` and `MAINTAINER_TOKEN_SECRET`, alongside
    the existing `APP_CLIENT_ID`.
  - **Testing:** CI's smoke job checks the token handling end to end, with
    tokens from `bynk token Maintainer`.
  - **Cloudflare Access, dropped:** the first version signed in through
    Access, whose GitHub login method never passes on the GitHub login.
- Phase 4, slice 5, step 4 (#48): the issues page at `/issues`, a fourth
  dashboard tab linked from the others.
  - **Each repository:** headline tiles (opened, closed by reason, time to
    close, open now, stale), and opened and closed per day. It also shows
    time to close by label, the backlog by age, and the stale issues with
    their labels.
  - **Outsiders:** figures on issues from outside the org appear only once
    there are any.
  - **Live:** the page updates over the live feed, which now sends a
    `kind: "issue"` event for each public issue delivery that changes what
    the page shows.
  - **Purging:** an issue event purges only `/metrics/issues`, on its own
    one-a-minute slot (migration `0015`). So issue traffic never empties the
    other routes' cache or delays their updates.
- Phase 4, slice 5, step 3 (#48): the issue-response routes.
  - **`GET /metrics/issues`:** over 7, 30 or 90 days, each public
    repository's issues opened, and closed as completed, not planned or
    duplicate. It gives time to close (p50 and p90) overall and by label,
    issues by UTC day, and response figures for issues from outside the org.
  - **`GET /metrics/issues/open`:** each repository's open backlog by age,
    and up to 20 of its stale issues (no update for 14 days) with their
    labels.
  - **Outsiders:** whether an issue's author is a maintainer is now
    recorded with the issue (`author_maintainer`, migration `0014`). It
    comes from the association, or else the cached org-membership lookup,
    as GitHub reports private members as contributors.
- Phase 4, slice 5, step 2 (#48): the daily open-issue sync.
  - **What it does:** the `issueSync` cron (04:53 UTC) lists each public
    repository's open issues through the REST API, leaving out the pull
    requests GitHub lists with them, and saves them as deliveries would.
  - **Repairs:** each issue still held open that GitHub didn't list is read
    on its own, when the listing was complete. It's saved as it now is, or
    becomes a `transferred` tombstone (answered under a new number) or a
    `deleted` one. An answer under the same number from a renamed repository
    is left alone.
  - **Failures:** renamed and vanished repositories are skipped with a
    warning, as the pull request sync does.
- Phase 4, slice 5, step 1 (#48): issue facts for issue response.
  - **Recording:** `issues` and `issue_comment` deliveries become `issues`
    rows and `issue_labels` (migration `0013`): one row per issue, moving
    only forward by `updated_at`, with its labels replaced alongside.
  - **Labels:** `labeled` and `unlabeled` add or remove the one label they
    name. The whole set is replaced only by a strictly newer delivery, so
    labels added in the same second combine whatever order they arrive in.
  - **First response:** the first comment by a maintainer who isn't the
    author and isn't a bot is recorded, and only moves earlier. It's
    recorded, not shown, until issues from outside the org arrive.
  - **Maintainers:** a maintainer is one by GitHub's author association,
    or, as GitHub reports a member with private membership as a
    contributor, a member of the organisation by GitHub's API. That uses
    the App's new **Members: Read-only** permission, and each answer is
    kept for a day in `org_members`.
  - **Edge cases:** comments on pull requests are ignored. Deleted and
    transferred issues become tombstones that a late delivery can't revive.
- Phase 4, slice 4, step 3 (#42): runner wait on the CI health page.
  - **Waiting for runners:** each repository's card gains a section. It
    shows waits by runner label (median, 95th percentile drawn as a range,
    longest) beside what is queued or awaiting approval now, with the
    window's 10 longest waits linking to their jobs.
  - **Slowest jobs:** each workflow's trend panel lists its jobs among the
    repository's slowest.
  - **Polling:** the section polls on its own pace, as jobs have no live
    feed: every 30 seconds for what's waiting, and every minute for the
    window.
- Phase 4, slice 4, step 2 (#42): the runner-wait routes.
  - **`GET /metrics/runners`:** over 7, 30 or 90 days, each public
    repository's waits for a runner by label (p50, p95, longest), its 10
    longest waits, and its 10 slowest jobs (with at least 3 runs). The figures
    are computed hourly by the `runnerFigures` cron into `runner_windows`
    (migration `0012`), rather than per request. Each figure reads its own
    partial index over generated `wait_seconds` and `took_seconds` columns, in
    order, so nothing is sorted. At 90 days' volume a run takes about 0.3 s.
  - **`GET /metrics/runners/now`:** jobs queued for a runner and held for an
    approval now, by runner label, read live from the waiting index.
- Phase 4, slice 4, step 1 (#42): job facts for runner wait.
  - **Recording:** `workflow_job` deliveries become `workflow_jobs` rows
    (migration `0011`), one per job attempt, moving only forward. Each row
    holds the runner label it asked for, its runner group, and when it was
    queued, started and completed. `started_at` is kept only once a runner
    has taken the job, so neither a queued job nor one cancelled before a
    runner took it reads as a zero wait. A job held for a protected
    environment's approval is marked (`approval`), and its wait isn't
    counted as a wait for a runner.
  - **Retention:** job deliveries are kept 7 days. Job rows are kept 90 days;
    then each day is rolled up into `workflow_job_days` (jobs, failures,
    approval-gated jobs, and the sums, medians and 95th percentiles of waits
    and durations) and pruned,
    one day a run.
  - **Setup:** the App must be subscribed to **Workflow job** events.
- Phase 4, slice 3, step 4 (#36): the releases page at `/releases`, linked to
  and from `/` and `/prs`. For each repository with a release:
  - tiles for releases, the time since the last, merge to release, what's
    waiting to ship, and the release workflow;
  - a chart of pull requests by people shipped per release;
  - the latest releases, with earlier ones folded away.

  The live feed carries releases as `kind: "release"` once what the page
  shows has settled: a final release on `released` (after matching, not on its
  `created` or `published`), a pre-release on `prereleased`, any release on
  `deleted`; on a delivery's first arrival, for public repositories, never
  drafts. The page
  refetches on those, and on pull requests merging. The CI page now acts on
  `run` events only.
- Phase 4, slice 3, step 3 (#36): the public releases routes.
  `GET /metrics/releases?days=7|30|90&repo=` gives, for each repository with a
  final release:
  - release cadence (count, pre-releases, median interval, latest);
  - merge to release for pull requests by people (median and 95th
    percentile);
  - what's waiting to ship since the latest release;
  - when its pull requests began to be recorded;
  - its release workflow's runs on tags, failures and median time (tags are
    recorded from `push` deliveries, in a new `tags` table).

  `GET /metrics/releases/recent?repo=` lists each repository's latest 20
  releases, with how many pull requests each shipped and how many were by
  people. Both are public, cached at the edge and rate-limited like the
  other metrics routes. Migration `0010` adds `tags` and the indexes they search by.
- Phase 4, slice 3, step 2 (#36): the daily release sync. A `releaseSync`
  cron service (04:47 UTC) lists each public repository's releases (up to 90)
  and records them, so release history is there from the first run; marks
  deleted any a complete listing no longer has; and matches each final
  release not yet tried since the repository's pull requests began to be
  recorded (at most 10 a run). A release whose previous release predates that
  still has its pull requests marked, but its `shipped` count stays null rather
  than short. A release with no previous final release, or whose comparison
  GitHub no longer has, is recorded as tried (`previous_tag` `''`, or the
  previous tag), so it never holds a repair slot.
  The pull request sync and this share the repository lookup.
- Phase 4, slice 3, step 1 (#36): release facts. `release` deliveries become
  `releases` rows (migration `0009`), one per repository and tag, kept when
  deleted. When a final release is published (its `released`
  delivery), the Worker finds the previous final release (up to 90 back),
  compares its tag with this one's, and marks each merged pull request whose merge commit is among those
  commits (or whose number a commit's first line names) with the release that
  first shipped it (`released_in`, `released_at`). `pull_requests` gains
  `merge_commit_sha`, recorded once a PR has merged. The App must be
  subscribed to **Release** events. See [docs/releases.md](docs/releases.md).
- The public metrics routes are now really cached at Cloudflare's edge.
  `@cache` alone only sends `Cache-Control`; Cloudflare doesn't store a
  response a Worker generates, so every request ran the Worker and read D1
  (the docs said otherwise). The Worker now declares
  `capability Edge = EdgeCache` (Workers Cache, experimental), so the routes'
  answers are kept at the edge for 30 seconds and every other response is sent
  `no-store`. Each live change purges `/metrics/`, at most once per 15 seconds
  (claimed in D1, migration `0008`; Cloudflare allows 5 purges a minute), and
  `LiveEvent` gains `refetch_ms`: 3 seconds when the purge went through, 31
  when it didn't. Both pages follow it, always ask the edge rather than their
  browser's copy, and refetch at most every 10 seconds.
- Phase 4, slice 2, step 4 (#26): the PR flow page at `/prs`, linked to and
  from the CI health page. For each public repository: tiles for merged, ready
  to merge, opened to merge, time in the merge queue and size; why pull
  requests left the queue; bots' figures; merges per day as a chart and a
  table; and the open pull requests with their stage, wait and a stale flag.
  It polls and listens on the live feed, which now carries pull requests too:
  `LiveEvent` gains `kind` (`run` or `pull`) and `number`, a pull request's
  delivery is pushed on its first arrival, and each page acts on its own kind.
- Phase 4, slice 2, step 3 (#26): public PR flow routes. `GET /metrics/prs`
  gives each repository's merged and closed-unmerged counts, time from ready
  (the headline, over pull requests whose ready time was seen, with how many)
  and from opened to merge, time in the merge queue and how many were
  requeued, median size, why pull requests left the queue other than by
  merging, merges by day, and bots' figures apart; over 7, 30 or 90 days.
  `GET /metrics/prs/open` lists open pull requests, longest waiting first,
  with their stage (draft, ready, queued) and whether they are stale. Public,
  cached and rate-limited like the CI routes. Migration `0007` adds the
  indexes they read. See docs/pr-flow.md.
- Phase 4, slice 2, step 2 (#26): the daily open-PR sync. A `pullSync` cron
  service (04:41 UTC) lists each public repository's open pull requests
  through the REST API, as the installation that last delivered for it, and
  saves each, filling in those opened before the service saw them. Each pull
  request still held open that GitHub no longer lists is read on its own and
  saved as it now is, repairing a lost `closed` delivery (at most 50 a
  repository per run, oldest first; one GitHub no longer has is marked
  `gone`). `DASHBOARD_EXCLUDE` repositories are skipped, and so, with a
  warning, are repositories with no known installation, ones GitHub answers
  `404`/`410` for, and renamed ones. Any other failure fails the run, after the
  rest have synced. Each repository's open list is saved in one D1 batch. Deliveries and the sync now save
  pull requests through one function, with the same ordering rules. See
  docs/pr-flow.md.
- Phase 4, slice 2, step 1 (#26): pull request facts. Every `pull_request`
  delivery creates or refreshes a `pull_requests` row (migration `0006`), one
  per PR: title, author and whether it is a bot, branches, draft, state
  (`open`, `merged` or `closed`), when it opened, became ready, closed and
  merged, and its commits and size. A row never moves backwards (a late
  `synchronize` can't reopen a merged PR), and `ready_at` only moves earlier.
  The moments the row can't hold (enqueued, dequeued and why, ready, back to
  draft, closed, reopened) go to `pull_request_events`, keyed by delivery so a
  redelivery adds nothing. `pull_request_review` deliveries fill
  `pull_request_reviews`, recorded for later and not shown yet. Kept
  indefinitely; data starts at deploy.
- Phase 4, history (#20): `GET /metrics/ci/history` gives each workflow's
  latest 20 completed attempts in the window and its runs, pass rate and
  median wall-clock time by UTC day, with `/metrics/ci`'s window, filters,
  caching and rate limit. The page shows the recent runs as a strip in each
  workflow's row (each mark links to its run, and one keyboard-reachable
  link per strip opens the workflow's runs; not-counted runs are half height) and, under **Trend**, daily charts of pass rate and median
  wall-clock time with a table of the same figures. On the live feed the page
  refetches the window figures and history only when a run completes.
- Phase 4, step 4 (#20): the CI health page updates live. It opens a
  WebSocket to `/live`, and each time a public, non-excluded run's facts
  change (not on redeliveries) the service pushes a small event to every open
  page through a `LiveBoard` agent (one Durable Object, at most 500
  connections; the oldest is evicted to make room, so vanished clients age
  out). The page refetches 3 seconds after the last event, polls only
  every 2 minutes while live, and falls back to 30-second polling if the feed
  drops. `scripts/live.mjs` checks the socket end to end in CI.
- Phase 4, step 3 (#20): the CI health page at `/`. One table per public
  repository: each workflow's state on its default branch (icon and label),
  pass rate, runs, median and 95th-percentile wall-clock time, flaky runs and
  a bar of passed, failed and not-counted runs; what is running now; and how
  much of the window has data. 7, 30 or 90 days. Polls the metrics routes
  every 30 seconds while visible, keeping open lists and focus across
  refreshes, dropping answers for a window no longer chosen, and saying
  which source is stale. `/` itself isn't cached, so a deploy never serves a
  page naming the previous deploy's assets. Light and dark themes from colour tokens;
  stacks into cards on narrow screens. The service's one-line description
  moves from `/` to `/about`.
- Phase 4, step 2 (#20): public CI metrics. `GET /metrics/ci` gives each
  workflow's runs, conclusions, pass rate (success over success, failure and
  timed out), median and 95th-percentile wall-clock time of successful
  attempts, and flaky runs, over a window of 1 to 90 days, filterable by
  repository, branch and trigger. `GET /metrics/ci/now` gives running attempts
  and each workflow's latest result on its repository's default branch, with
  `red_since`. No token; public repositories only, less `DASHBOARD_EXCLUDE`;
  cached 30 seconds; `days` is 7, 30 or 90, `event` a GitHub trigger and
  `branch` a ref name, and each address may make 60 uncached requests a
  minute (`bynk.cloudflare.RateLimit`), so the public routes' D1 reads stay
  bounded. Migration `0005` records each repository's default
  branch and indexes `workflow_runs` by completion time. See
  docs/ci-metrics.md.
- Phase 4, step 1 (#20): every `workflow_run` delivery updates a
  `workflow_runs` row (migration `0004`), one per run attempt, with its
  workflow, branch, trigger, status, conclusion and queued/started/completed
  times (each attempt's own `queued_at`: a re-run keeps the run's
  `created_at`). A row only moves forward, so out-of-order deliveries can't
  undo a completed run. A `repositories` table records whether each
  repository is public, from its latest delivery, for the public dashboard to
  join. Kept indefinitely; the CI dashboard's metrics will read them. Data
  starts at deploy (no backfill).
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

- Enrolled in the bynk-lang Bynk canary. The Bynk version lives in
  `BYNK_VERSION`, which CI reads through the org's `bynk-ci` and `setup-bynk`
  actions (replacing the local install action and its hand-pinned SHA-256;
  the archive is now checked against the release's `SHA256SUMS`). The smoke
  job is a callable workflow, `smoke.yml`. `bynk-canary.yml` runs the checks,
  the smoke and live-feed checks, and a deploy dry run against each new Bynk
  release, keeps a `canary` issue open while they fail, and proposes moving
  `BYNK_VERSION` once one passes.
- Built and tested with Bynk v0.510.34 (v0.1.0: v0.492.1), kept current by
  the canary. The moves made room for:
  - **`Bot.react` takes the `Delivery`** itself instead of reading it again
    from its parts, now that a capability may take a commons type
    (bynk-lang/bynk#2886).
  - **Typed `PullPayload` values** in the open-PR sync tests, now that a suite
    helper may name a commons type (bynk-lang/bynk#2947). Each case encodes
    them, as `Json.encode` in a helper still fails (bynk-lang/bynk#2990).
    `Json.encode` writes `Option` tagged, not as GitHub does
    (bynk-lang/bynk#2991), so a new case sends GitHub's own REST JSON (plain
    values, `null`s, a deleted fork's `null` repository) to pin the wire
    format.
  - **Forged and expired tokens** in the read API's refusal tests (`by
    Forged`, `by Expired`).
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

- Each kind of live change purges only the routes it changes, on its own
  slot (#62, migration `0019`). Runs purge `/metrics/ci` every 20 seconds at
  most; pull requests and releases share a slot for `/metrics/prs` and
  `/metrics/releases`, once a minute; issues keep theirs. Before, runs, pull
  requests and releases shared one slot that purged every metrics route, so a
  burst of CI runs spent the purges a merge needed. The maintainers' shared
  figures follow each route's own slot.
- The slowest jobs are matched to their workflow by its file, not by the
  workflow's name, which two workflow files can share (#62). Each job keeps its
  run's file (migration `0020`, which fills it in on the jobs already
  recorded), so the hourly figures don't join every job to its run.
  `/metrics/runners`' slowest jobs carry `path`.
- The trend charts' duration axis labels ticks under a minute in seconds, and
  keeps one decimal of minutes: a 30-second tick read "1 m", and a 150-second
  one "3 m" (#62).
- Organisation membership is read from GitHub's membership endpoint
  (`GET /orgs/{org}/memberships/{login}`), not the "check membership" one,
  which answers `404` when it won't show a private membership. Private
  members, the owner among them, were refused at maintainer sign-in and could
  count as outsiders in issue response. A `403` (the App can't see members) is
  now an error, never "not a member".
  Migration `0016` forgets the "not a member" answers kept so far, so each
  login is asked again; the daily issue sync then corrects open issues'
  `author_maintainer`. First responses missed in the meantime aren't
  recovered.
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

[Unreleased]: https://github.com/bynk-lang/github-hooks/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/bynk-lang/github-hooks/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/bynk-lang/github-hooks/releases/tag/v0.1.0
