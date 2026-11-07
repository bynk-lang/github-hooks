# Issue response

The fifth slice of the public dashboard
([#48](https://github.com/bynk-lang/github-hooks/issues/48)): whether issues
are closed as fast as they're opened, how long they take to close, and what
is open and gone quiet. Later, once people outside the org file issues, it
also covers how long they wait for a maintainer to respond. This page covers
what is recorded, the daily sync that keeps it right, the public routes that
read it, and the page at `/issues`.

## What the data says about the design

In the 30 days to 6 Nov, all 509 `bynk` issues were opened by the maintainer
account. None had a comment from a second human; the only other comments came
from `claude[bot]` and `dependabot[bot]`. So a maintainer's first response is
**recorded but not shown** until issues from outside the org arrive, as PR
flow does with reviews. The figures lead with flow instead: opened against
closed, time to close by label, the open backlog, and stale issues.

## What is recorded

The App already receives `issues` and `issue_comment` deliveries (phase 3's
welcome reads them), so nothing new needs subscribing. Migration `0013` adds
three tables, filled as deliveries arrive and kept indefinitely (retention
prunes `deliveries`, not these).

- **`issues`**: one row per issue, from any `issues` or `issue_comment`
  delivery (each carries the whole issue).
  - **Ordering:** a row only moves forward by `updated_at`; on a same-second
    tie the later arrival wins. So a late `labeled` never undoes `closed`, and
    a redelivery changes nothing.
  - **State:** GitHub's `state` and `state_reason` (`completed`,
    `not_planned`, `duplicate`, or `reopened` after a reopen, which also
    clears `closed_at`).
  - **Author:** the login, whether it's a bot (`user.type = 'Bot'`), and
    GitHub's `author_association`, which tells a maintainer (`OWNER`,
    `MEMBER`, `COLLABORATOR`) from everyone else.
  - **`author_maintainer`** (migration `0014`): whether the author is a
    maintainer. It's settled when the issue is recorded, by a delivery or the
    daily sync.
    - **Known at once:** a bot isn't one, and an owner, member or
      collaborator by association is.
    - **Asked:** for anyone else, the organisation is asked with the same
      cached lookup as for commenters (below). GitHub reports a member whose
      membership is private as a `CONTRIBUTOR`, and maintainers open most
      issues.
    - **Unknown:** `NULL` until the organisation answers. A failed lookup
      leaves the row's last answer as it was, with a warning.
  - **First response:** `first_response_at` and `first_responder` come from
    the first comment by a maintainer who isn't the issue's author and isn't
    a bot (a bot never counts, even one GitHub reports as a member). The
    response only moves earlier, so a comment delivered late still counts.
  - **Who is a maintainer:** an `OWNER`, `MEMBER` or `COLLABORATOR` by
    GitHub's author association, or a member of the organisation by GitHub's
    API.
    - **Why ask:** GitHub reports a member whose membership is **private** as
      a `CONTRIBUTOR` (or `NONE`), so for any other commenter the service asks
      `GET /orgs/{org}/memberships/{login}`, through the installation that
      sent the delivery. An `active` membership is a member; a `pending`
      invitation and a `404` are not. That needs the App's **Members:
      Read-only** permission ([setup](github-app.md)).
    - **Not the "check membership" endpoint:** `GET /orgs/{org}/members/{login}`
      answers `404` both for a non-member and when it won't show the asker a
      private membership, so it once read private members as outsiders.
      Migration `0016` forgot those answers.
    - **Caching:** the answer is kept in `org_members` and reused for a day.
    - **Failures:** if GitHub can't say (a missing permission, an outage), the
      comment isn't counted, and a warning says why.
    - **Cost:** today every commenter is a public member or a bot, so the API
      isn't called at all. A deleted comment
    isn't a response, and deleting the first response doesn't clear it.
  - **Deleted and transferred issues:** these become tombstones (`state`
    `deleted` or `transferred`) with no labels. Nothing later changes them,
    so a late delivery can't bring one back. They're counted nowhere. A
    transferred issue reappears under its new repository from that
    repository's own deliveries.
- **`issue_labels`**: each issue's current labels.
  - **Ties:** adding several labels at once sends one `labeled` delivery per
    label, usually in the same second. Each carries the set at that moment,
    and they arrive in no guaranteed order.
  - **Whole set:** so the set is replaced only by a delivery strictly newer
    than the row.
  - **One label:** `labeled` and `unlabeled` then add or remove the one label
    they name, so same-second deliveries combine rather than overwrite one
    another, whatever order they arrive in.
  - **Stale deliveries:** a delivery the row has moved past never brings back
    an old set.

- **`org_members`**: GitHub's answers on organisation membership, by
  organisation and lower-case login, each reused for a day (see **Who is a
  maintainer** above).

**Comments on pull requests** also arrive as `issue_comment`, with
`issue.pull_request` set. They record nothing here; PR flow keeps its own
facts.

**Volume:** about 100 `issues` and 45 `issue_comment` deliveries a day across
the organisation. Each costs a few D1 writes: the row, plus one per label.

## History

There's no backfill: closed-issue figures start when this ships. The daily
sync below keeps the open backlog right from its first run.

## The daily sync

Deliveries alone miss two things: issues opened before the service saw them,
and a `closed` (or `deleted`, or `transferred`) delivery that never arrived,
which would leave an issue open for good. The `issueSync` cron service, daily
at 04:53 UTC, repairs both. It runs six minutes after the release sync.

1. **Listing:** for each public repository (not in `DASHBOARD_EXCLUDE`), it
   lists the open issues through the REST API, as the installation that last
   delivered for that repository. It reads up to 500, a page of 100 at a time,
   and saves them all in one D1 batch.
   - **Pull requests:** GitHub lists open pull requests here too (with
     `pull_request` set). They're left out.
   - **Ordering:** each saved issue follows the delivery rules above. A
     listing older than what deliveries recorded changes nothing, and its
     labels replace the set only when it's strictly newer.
2. **Repairs:** each issue the table still holds open that GitHub didn't list
   is read on its own and saved as it now is. The oldest go first, at most 50
   a repository per run.
   - **Complete listings only:** repairs run only when the listing ended with a
     short page. Past 500 open issues and pull requests, the rest are unread,
     not closed, so repairs are skipped with a warning rather than re-reading
     the same open issues every day.
   - **Transferred:** GitHub follows an old address to where the issue now is.
     A transfer gives the issue a new number, so one answered under another
     number becomes a `transferred` tombstone.
   - **Renamed:** a rename keeps the number, so an answer under the same
     number from a differently named repository is a rename. It's left alone
     for the new name's own sync. This covers a renamed repository with
     nothing open, whose empty listing names no repository.
   - **Deleted:** one GitHub answers `404` or `410` for becomes a `deleted`
     tombstone.

It reads as the App, with the installation token the other syncs use, so it
needs only the **Issues: Read** permission the App already has. A refused call
is retried once with a fresh token.

**What it skips, with a warning rather than failing the run**, since each would
otherwise fail every day:

- a repository no installation has delivered for (and one whose deliveries
  have all aged out after the App was uninstalled);
- a repository GitHub answers `404` or `410` for;
- a renamed repository: GitHub redirects the old name, and the listed issues
  name the new one, which syncs under its own row.

Anything else (a refused token, a `5xx`, an issue that won't decode) fails the
run, naming each repository, after the others have synced. Each repository
logs one line:

```text
issue sync: bynk-lang/bynk has 22 open, 0 repaired
```

"Repaired" counts issues the run moved out of `open`. A repair that failed is
counted under "failed" instead.

**Its cost per run**, per repository: at most 5 list pages and 50 single reads
from GitHub (plus a token from KV), and a handful of D1 calls (the listing is
saved in one batch, and each repair in one more). With the pull request and
release syncs, that's far inside a Worker invocation's subrequest limit for
bynk-lang's few public repositories.

## Routes

Both are public, unauthenticated, `@cache(maxAge: 30.seconds, scope: public)`
and share the metrics rate limit, like the other metrics routes. They cover
public repositories less `DASHBOARD_EXCLUDE`, decided as the route reads, and
take an optional `?repo=owner/name`. Tombstones (deleted and transferred
issues) count nowhere. Every figure but the `bots_` ones is for issues opened
by people. Times are nearest-rank percentiles, in seconds.

### `GET /metrics/issues?days=7|30|90&repo=owner/name`

The window is 7 days (the default), 30 or 90; any other `days` is a 400.

```json
{
  "since": "2026-10-29T12:00:00.000Z",
  "until": "2026-11-05T12:00:00.000Z",
  "data_since": "2026-11-01T06:00:00.000Z",
  "repos": [
    {
      "repo": "bynk-lang/bynk", "opened": 12, "completed": 5, "not_planned": 2, "duplicate": 1,
      "close_p50_seconds": 86400, "close_p90_seconds": 1123200,
      "outside_opened": 3, "outside_responded": 1, "outside_waiting": 1,
      "response_p50_seconds": 7200, "response_p90_seconds": 7200,
      "bots_opened": 1
    }
  ],
  "labels": [
    {"repo": "bynk-lang/bynk", "label": "bug", "completed": 3, "p50_seconds": 86400, "p90_seconds": 86400},
    {"repo": "bynk-lang/bynk", "label": null, "completed": 1, "p50_seconds": 3600, "p90_seconds": 3600}
  ],
  "daily": [{"repo": "bynk-lang/bynk", "day": "2026-11-04", "opened": 4, "closed": 3}]
}
```

- **`opened`:** issues opened in the window.
- **`completed`, `not_planned`, `duplicate`:** issues closed in the window, by
  GitHub's reason. An old close with no reason counts as completed. A
  reopened issue has no close time, so it isn't counted as closed.
- **`close_*`:** `closed_at − opened_at`, over the `completed` ones.
- **`labels`:** the same time to close for each label, an issue counting once
  for each label it carries. `null` is issues with none. Busiest first.
- **`outside_*`, `response_*`:** for issues opened in the window by people
  outside the org. That's not an owner, member or collaborator by GitHub's
  association, nor confirmed as a member when the issue was recorded
  (`author_maintainer`).
  - **Figures:** `outside_responded` had a maintainer's first response, and
    `response_*` is how long it took. `outside_waiting` are still open with
    none.
  - **Today:** every bynk-lang issue is a maintainer's own, so these are zero
    until people outside the org file issues. The page will show them only
    then.
- **`daily`:** issues opened, and closed for any reason, per UTC day.
- **`data_since`:** the first close recorded, in any repository. Closed-issue
  figures have no backfill, so a reader can tell a full window from a partly
  covered one.

### `GET /metrics/issues/open?repo=owner/name`

```json
{
  "backlog": [
    {
      "repo": "bynk-lang/bynk", "open": 7, "under_day": 1, "under_week": 4, "under_month": 1, "older": 1,
      "oldest_opened_at": "2026-10-01T00:00:00.000Z", "stale": 1, "bots_open": 1
    }
  ],
  "stale": [
    {
      "repo": "bynk-lang/bynk", "number": 8, "title": "Eight", "author": "accuser",
      "labels": ["enhancement", "proposal"],
      "opened_at": "2026-10-01T00:00:00.000Z", "updated_at": "2026-10-10T00:00:00.000Z",
      "url": "https://github.com/bynk-lang/bynk/issues/8"
    }
  ]
}
```

- **`backlog`:** each repository's open issues now, by age: under a day, a
  day to a week, a week to 30 days, and older. It also gives the oldest one's
  opening, and how many are `stale`.
- **`stale`:** issues open with no update for **14 days** (`ISSUE_STALE`),
  least recently updated first, each with its labels and a link. At most 20
  a repository (`MAX_STALE_ISSUES`), so one repository's long tail can't
  crowd out the others; its `backlog` row counts them all.

The daily sync keeps the backlog right from the first run, so these need no
history.

### Queries

**Indexes:** each read is index-driven, as `EXPLAIN QUERY PLAN` shows.
- **The window:** issues opened or closed in it, through `issues_by_opened`
  and `issues_by_closed` (an `OR` of the two ranges).
- **Labels:** each issue's labels by `issue_labels`' primary key.
- **The open backlog and stale list:** through the partial `issues_open`.
- **Outsiders:** decided from the issue's own row (`author_association` and
  `author_maintainer`), with no lookup at read time.

**Cost:** against a year of `bynk`'s volume (6,500 issues, each with about
one and a half labels) in SQLite, each query takes 1–2 ms.

## The page

`/issues` is the fourth dashboard tab, linked to and from the others. It
shares their stylesheet, the 7/30/90-day window choice, and the freshness
line. A coverage line says how much of the window closed-issue figures cover,
as there's no backfill. For each repository with issues it shows:

- **Headline tiles:** issues opened; closed, split into completed, not
  planned and duplicates; time to close (median, with the 90th percentile);
  open now, with the oldest one's age; and how many are stale.
- **Opened and closed per day:** two single-series charts side by side on the
  same scale, with the daily figures in a table under them.
- **Time to close by label:** the 8 busiest labels, with "No label" among
  them, and the rest folded away.
- **Open by age:** under a day, 1–7 days, 7–30 days, and over 30.
- **Stale:** each stale issue with its labels, how long it has been quiet,
  and how long ago it was opened, linking to GitHub. That's up to 20 a
  repository; the heading says how many there are in all.
- **Outsiders:** a line on issues from outside the organisation (answered,
  how fast, still waiting) appears only once there are any, as decided on
  #48. Bots' issues get a line of their own.

Everything from GitHub is set as text, never markup. The page polls every 30
seconds (the backlog) and every minute (the window), and slows to a safety net
while the live feed is up.

## Live feed

Issues share the live feed with runs, pull requests and releases. Each
`issues` or `issue_comment` delivery for an issue (not a pull request) is
pushed as `kind: "issue"`, with the repository and `number`, the delivery's
action as `status`, and the issue's state as `conclusion`:

```json
{"refetch_ms": 3000, "kind": "issue", "repo": "bynk-lang/bynk", "number": 2982, "path": "",
 "workflow": "", "run_id": 0, "attempt": 0, "status": "closed", "conclusion": "closed"}
```

**When it's sent:** only for an action that changes what the issues page
shows.
- **Issues:** opened, edited (the title), closed, reopened, labelled,
  unlabelled, deleted or transferred.
- **Comments:** a new comment, which makes an issue no longer quiet.
- **Not sent:** assignments, milestones, pins, locks and comment edits. These
  change nothing the page shows.

It's sent on the delivery's first arrival only, and only for a repository the
public pages may show. The issues page acts on `issue` events, and the others
ignore them.

**Purging:**
- **Prefix:** unlike the other kinds, an issue event purges only
  `/metrics/issues`. So a burst of comments doesn't empty the CI, PR and
  release routes' cache.
- **Throttle:** it has its own slot (`edge_purge_slots`, migration `0015`), as
  runs and pull requests have since `0019` (#62), so no kind spends another's
  purges.
- **Rate:** that slot allows one purge a minute. With the runs' 3 and pull
  requests' and releases' 1, that keeps the Worker within Cloudflare's 5 a
  minute ([ci-metrics.md](ci-metrics.md#live-feed)). An issue event inside the
  minute is told to wait for the cache to expire.

Otherwise the refetch timing (`refetch_ms`, the purge and its follow-up) is
the PR page's ([pr-flow.md](pr-flow.md#live-feed)).

