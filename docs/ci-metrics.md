# CI metrics

The **CI health page** at `/` shows these figures for every public
repository, updated live as runs change (see *Live feed* below), with polling
as a fallback (and pausing while the tab is hidden): each workflow's state on its default branch, pass rate, run count,
median and 95th-percentile time, flaky runs and a bar of how its runs ended.
It is plain HTML, CSS and JavaScript (`embeds/dashboard.html`, `assets/`),
with colour tokens in one place for branding later. The routes below are
what it reads, and are public for anyone else to read too.

Phase 4 (#20) of github-hooks: the health of the organisation's CI, built
from the `workflow_run` deliveries the service already receives. These routes
are **public**: no token. They show only repositories whose latest delivery
says they're public, less any named in `DASHBOARD_EXCLUDE`. Each answer is
cached at Cloudflare's edge for 30 seconds per URL (`Cache-Control: public,
max-age=30`, served through Workers Cache by `bynk.cloudflare.EdgeCache`), so
repeated views are answered without running the Worker or reading D1. A live
change purges the cache (see [Live feed](#live-feed)). Each address may make
60 uncached requests a minute; past that the answer is `429`.

There is no backfill: data starts when `workflow_runs` was deployed.
`data_since` says when, so a 30-day window with 3 days of data reads as that.

## `GET /metrics/ci`

Each workflow's health over a window, from its completed attempts, counted
by when they completed.

| Query | Meaning | Default |
|---|---|---|
| `repo` | `owner/name`, matched whatever its case | every public repository |
| `branch` | the run's head branch: letters, digits and `. _ / + -`, at most 200 | every branch |
| `event` | what triggered the run, one of the events GitHub defines: `push`, `pull_request`, `merge_group`, `schedule`, … | every trigger |
| `days` | how far back the window reaches: `7`, `30` or `90` | 7 |

Anything else is `400` before anything is read. The routes are public and
cached per URL, so the query is kept to values the page actually asks for:
each is then a cache hit for every other viewer.

```sh
curl "https://github-hooks.<subdomain>.workers.dev/metrics/ci?repo=bynk-lang/bynk&event=merge_group&days=30"
```

```json
{
  "since": "2026-10-06T12:00:00.000Z",
  "until": "2026-11-05T12:00:00.000Z",
  "data_since": "2026-11-05T06:32:42.000Z",
  "workflows": [
    {
      "repo": "bynk-lang/bynk",
      "path": ".github/workflows/ci.yml",
      "workflow": "CI",
      "runs": 8,
      "success": 4, "failure": 1, "timed_out": 1,
      "cancelled": 1, "skipped": 1, "other": 0,
      "pass_percent": 67,
      "wall_p50_seconds": 600,
      "wall_p95_seconds": 1800,
      "flaky": 1
    }
  ]
}
```

What each number means:

- **`runs`**: completed attempts in the window. A re-run is another attempt.
- **`pass_percent`**: `success / (success + failure + timed_out)`, rounded;
  `null` when none of those happened. `cancelled` (usually a superseded run),
  `skipped` and anything else are counted but don't count against it.
- **`wall_p50_seconds`, `wall_p95_seconds`**: the median and 95th percentile
  (nearest rank) of wall-clock time, from when the attempt was queued to when
  it completed, over successful attempts. It includes any wait for runners:
  GitHub queues per job, not per run, so the run alone can't separate the two.
- **`flaky`**: runs whose first attempt failed and a re-run succeeded.
- **`workflow`**: the latest name seen. Workflows are grouped by `path`, which
  survives a rename.

## `GET /metrics/ci/now`

What is running, and each workflow's latest result on its repository's
default branch. `?repo=owner/name` narrows both.

```json
{
  "in_flight": [
    {
      "repo": "bynk-lang/bynk", "path": ".github/workflows/ci.yml", "workflow": "CI",
      "run_id": 41981894779, "attempt": 1, "branch": "gh-readonly-queue/main/pr-512-…",
      "event": "merge_group", "status": "in_progress", "queued_at": "2026-11-05T06:39:39.000Z"
    }
  ],
  "main": [
    {
      "repo": "bynk-lang/bynk", "path": ".github/workflows/ci.yml", "workflow": "CI",
      "branch": "main", "conclusion": "failure",
      "completed_at": "2026-11-05T11:40:00.000Z", "red_since": "2026-11-05T11:00:00.000Z"
    }
  ]
}
```

- **`in_flight`**: attempts not yet completed and queued in the last day. One
  still "running" after a day lost its `completed` delivery and is left out.
- **`main`**: for each workflow, its latest `push` to the repository's default
  branch (recorded from the deliveries; not assumed to be `main`) that
  concluded `success`, `failure` or `timed_out`, from the last 90 days.
  `red_since` is set when that was a failure: the first failure after the last
  success. `cancelled` and `skipped` runs don't change the state, and neither
  do `merge_group` runs: a failed one is a pull request the merge queue
  rejected, which is what keeps the default branch green. A workflow that never
  runs on a `push` to the default branch doesn't appear here.

## `GET /metrics/ci/history`

Each workflow's recent runs and its health day by day, over the same window
and filters as `/metrics/ci` (`days`, `repo`, `branch`, `event`). Public,
cached and rate-limited the same way.

```json
{
  "since": "2026-10-29T12:00:00.000Z",
  "until": "2026-11-05T12:00:00.000Z",
  "recent": [
    {
      "repo": "bynk-lang/bynk", "path": ".github/workflows/ci.yml", "run_id": 41981894779,
      "attempt": 1, "branch": "main", "event": "push", "conclusion": "success",
      "completed_at": "2026-11-05T10:10:00.000Z", "wall_seconds": 600
    }
  ],
  "daily": [
    {
      "repo": "bynk-lang/bynk", "path": ".github/workflows/ci.yml", "day": "2026-11-05",
      "runs": 8, "success": 4, "failed": 2, "other": 2,
      "pass_percent": 67, "wall_p50_seconds": 600
    }
  ]
}
```

- **`recent`**: each workflow's latest 20 completed attempts in the window,
  oldest first (per workflow; the list is ordered by repository, path, then
  completion). `wall_seconds` is `completed_at - queued_at` whatever the
  conclusion. `conclusion` is `unknown` if a completed delivery carried none.
- **`daily`**: one entry per workflow per UTC day (by completion) that has a
  completed attempt; a day with none has no entry. The definitions are
  `/metrics/ci`'s: `failed` is `failure` + `timed_out`, `other` is every
  attempt not judged, `pass_percent` is `null` on a day nothing was judged,
  and `wall_p50_seconds` is the nearest-rank median over successful attempts.
  The window's first and last days are partial.

On the page, the recent runs are a strip in each workflow's row (each mark
links to the run on GitHub for a pointer; runs the pass rate doesn't count
are drawn half height). For keyboards and screen readers, one link per strip
carries its summary and opens the workflow's runs on GitHub; it shows when
focused. **Trend** opens a chart of the daily pass rate, a chart of the
daily median wall-clock time, and a table of the same figures.

## Settings

| Name | Meaning |
|---|---|
| `DASHBOARD_EXCLUDE` | optional. Comma-separated `owner/name` list kept off the public metrics, for example `bynk-lang/github-hooks-sandbox` |

Set or change it with `wrangler secret put`, as for the phase 3 settings
([github-app.md](github-app.md#7-let-the-app-act-phase-3)): a redeploy alone
keeps the old value.

Making a repository private hides its whole history at once. Subscribing the
App to **Repository** events makes that immediate (`privatized`, `publicized`);
otherwise it applies with the repository's next delivery.

## Live feed

The page opens a WebSocket to `/live?board=ci&client=<random id>` and is sent
an event whenever a public run's facts change:

```json
{"refetch_ms": 3000, "kind": "run", "repo": "bynk-lang/bynk", "number": 0,
 "path": ".github/workflows/ci.yml", "workflow": "CI", "run_id": 41981894779, "attempt": 1,
 "status": "completed", "conclusion": "success"}
```

`conclusion` is `""` until the run completes. Pull requests, releases and
issues share the feed as `kind: "pull"`, `kind: "release"` and
`kind: "issue"` events ([pr-flow.md](pr-flow.md#live-feed),
[releases.md](releases.md#live-feed), [issues.md](issues.md#live-feed)),
which this page ignores.

**Purging, and when to refetch.** Before an event is sent, the Worker purges
the routes it changes from the edge cache, so a refetch shortly after sees the
change. Each kind of change has its own slot in D1 (`edge_purge_slots`,
migrations `0015` and `0019`, #62), claimed across every isolate, so a burst of
one kind never spends another's purges. Cloudflare allows a Worker 5 purges a
minute, so:
- **runs** purge `/metrics/ci`, at most every 20 seconds;
- **pull requests and releases** share a slot, purging `/metrics/prs` and
  `/metrics/releases` (a merge changes both pages), at most once a minute;
- **issues** purge `/metrics/issues`, at most once a minute
  ([issues.md](issues.md#live-feed)).

`refetch_ms` tells the page how long to wait: 3 seconds when the purge went
through, or 31 seconds (until any copy cached before the change has expired)
when it was throttled or Cloudflare refused it.

The page treats an event as a nudge: after `refetch_ms` it refetches
`/metrics/ci/now`, and `/metrics/ci` and `/metrics/ci/history` too if any run
completed meanwhile (nothing else moves them), so what it shows always follows
the routes' definitions. A purge clears every earlier change's stale copies
too; events during a wait never postpone the refetch, so a steady stream of
runs still refreshes the page; and refetches are at least 10 seconds apart.
Every open page hears of a purge at once, so each adds up to 4 seconds at
random, letting the first request at each edge location refill the cache for
the rest. A purged event is also followed by one more refetch 31 seconds
later: a request that read D1 just before the change can refill the cache just
after the purge, and that copy has expired by then.
The page always asks the edge (`cache: "no-cache"`), never its browser's own
copy, which a purge wouldn't reach. While
the feed is connected it polls only every 2 minutes, as a safety net; if the
feed drops it reconnects with backoff (5 seconds, doubling to a minute) and
polls every 30 seconds meanwhile.

- **What is sent:** only a change (a redelivery, or a late delivery that moves
  nothing, sends nothing), and only for a repository the page may show
  (public, not in `DASHBOARD_EXCLUDE`).
- **Who may connect:** anyone, like the page. The connections live in one
  Durable Object (`LiveBoard`), which holds at most 500. Past that the
  *oldest* is closed to make room, so connections whose clients vanished
  without a close (a shut laptop, a dropped network) age out instead of
  filling the board, and no one client can hold it. An evicted page sees its
  socket close, polls, and reconnects.
- **Each connection has its own id,** made afresh by the page every time it
  connects, so an old socket's late close can never remove its replacement.
- **`board`** is always `ci`. It is a route parameter rather than fixed in the
  code because of bynk-lang/bynk#2959.
- **Testing:** suites can't drive a WebSocket yet, so the rule for what is
  pushed is tested through a `LiveFeed` capability (`tests/live.bynk`), and
  the socket end to end by `scripts/live.mjs`, which CI's smoke job runs
  against the local Worker (`SMOKE_LIVE=1`). It records a made-up run, so it
  doesn't run against production by default.
