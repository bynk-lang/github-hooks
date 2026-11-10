# PR flow

The second slice of the public dashboard
([#26](https://github.com/bynk-lang/github-hooks/issues/26)): how long pull
requests take to land, what is open now, and how the merge queue behaves. This
page covers what is recorded, how it is kept correct, the public routes that
read it, and the page at `/prs`.

## What is recorded

Migration `0006` adds three tables, filled as deliveries arrive and kept
indefinitely (retention prunes `deliveries`, not these).

- **`pull_requests`**: one row per pull request (`state` is `open`, `merged`,
  `closed`, or `gone` when GitHub no longer has it), from any `pull_request`
  delivery (each carries the whole PR) and from the daily sync below. A row
  only moves forward by `updated_at`. On a same-second tie the newer source
  applies unless it would take the PR out of `merged`, which is final.
  `ready_at` is `created_at` for a PR opened ready, else the `ready_for_review`
  delivery's `updated_at`, and only ever moves earlier. Sizes and `commits`
  come only from deliveries and from reading one PR (the list endpoint omits
  them), and keep their last known values.
- **`pull_request_events`**: the moments a row can't hold (`enqueued`,
  `dequeued` with GitHub's `reason`, `ready_for_review`, `converted_to_draft`,
  `closed`, `reopened`), keyed by delivery so a redelivery adds nothing, and
  timed by when the delivery arrived. GitHub sends `dequeued` with reason
  `MERGE` when a PR leaves the queue by merging, so only other reasons mean
  the queue turned a PR away.
- **`pull_request_reviews`**: each review, keyed by GitHub's review id.
  `dismissed` is final. Recorded but not shown yet.
- **For the maintainers' view** (migration `0017`, #53):
  - **`head_sha`:** each PR's head commit. Its CI is found by commit, not by
    branch name, since a fork's `main` isn't the base repository's.
  - **`pull_request_review_requests`:** whose review a PR is waiting on, a
    user's login or a team's slug. A delivery's whole set
    (`requested_reviewers`, `requested_teams`) replaces the stored one only
    when the delivery is strictly newer. Requests made in the same second
    arrive as deliveries with one `updated_at`, each listing the set at its
    moment in no fixed order, so `review_requested` and
    `review_request_removed` also add or remove the one request they name,
    as issue labels are kept ([issues.md](issues.md)). A submitted review
    takes its reviewer's own request off, as GitHub does. The review's own
    pull request isn't saved, being a partial view.
  - **Out of order** (migration `0022`, #68): a request, its removal and a
    review are put in order by their times, whatever order they arrive in.
    Each request keeps when it was made (`requested_at`, the delivery's
    `updated_at`). A removal (at the pull request's `updated_at`) or the
    reviewer's submitted review (at its `submitted_at`) deletes it only if it
    was made no later, and leaves a tombstone
    (`pull_request_review_tombstones`). A request isn't added if a tombstone
    is as new or newer. So a CODEOWNERS auto-request withdrawn a moment later
    stays withdrawn, whichever delivery comes first, and a re-request made
    after a review stays. Within one second the order is unknown and the
    removal wins, until the daily sync. A set (a strictly newer delivery's, or
    the sync's) settles the tombstones no later than it. Retention prunes
    those older than a day. Bynk's guide
    [*Apply webhook events that arrive out of order*](https://bynk-lang.org/book/guides/effects-and-capabilities/apply-webhook-events-out-of-order/)
    describes the pattern, from this work.
  - **The daily sync** fills both for open pull requests. It reads GitHub's
    current state, so at a tie its set of requests replaces the stored one,
    which back-fills pull requests recorded before requests were.

## The daily sync

Deliveries alone miss two things: pull requests opened before the service saw
them, and a `closed` delivery that never arrived (which would leave a PR open
for good). The `pullSync` cron service, daily at 04:41 UTC, repairs both:

1. For each public repository (not in `DASHBOARD_EXCLUDE`), it lists the open
   pull requests through the REST API as the installation that last delivered
   for that repository (up to 500, a page of 100 at a time), and saves them all
   in one D1 batch.
2. Each pull request the table still holds open that GitHub didn't list is read
   on its own and saved as it now is: merged or closed, with its times. The
   oldest go first, at most 50 a repository per run. One GitHub answers `404`
   or `410` for (moved with a transferred repository, or removed) is marked
   `gone`, so it leaves the open set and the next run's window.

The sync never sets `ready_at`: the pulls API doesn't say when a PR became
ready. So a PR it fills in counts towards "opened → merged" but not "ready →
merged".

It reads as the App, with the installation token welcomes already use, so it
needs only the **Pull requests: Read** permission the App already has. A
refused call is retried once with a fresh token, as comments are.

**What it skips, with a warning rather than failing the run**, since each would
otherwise fail every day:

- a repository no installation has delivered for (and one whose deliveries
  have all aged out after the App was uninstalled);
- a repository GitHub answers `404` or `410` for;
- a renamed repository: GitHub redirects the old name, and the listed pull
  requests name the new one, which syncs under its own row.

Anything else (a refused token, a `5xx`, a pull request that won't decode)
fails the run, naming each repository, after the others have synced. Each
repository logs one line:

```text
pull request sync: bynk-lang/bynk has 5 open, 0 repaired
```

"Repaired" counts pull requests the run moved out of `open`; a repair that
failed is counted under "failed" instead.

**Its cost per run**, per repository: at most 5 list pages and 50 single reads
from GitHub (plus a token from KV), and a handful of D1 calls (the open list is
saved in one batch; each repair in one more). For bynk-lang's few public
repositories that is far inside a Worker invocation's subrequest limit. If the
organisation grows to dozens of busy repositories, the next step is one queue
message per repository, so each runs in its own invocation.

## `GET /metrics/prs`

Each public repository's pull request flow over a window: `?days=7` (the
default), `30` or `90`, and optionally `?repo=owner/name`. Public, cached 30
seconds, and limited to 60 uncached requests a minute per address, like the CI
routes; public repositories only, less `DASHBOARD_EXCLUDE`.

```json
{
  "since": "2026-10-29T12:00:00.000Z",
  "until": "2026-11-05T12:00:00.000Z",
  "data_since": "2026-11-05T09:01:24.377Z",
  "repos": [
    {
      "repo": "bynk-lang/bynk", "merged": 3, "closed_unmerged": 1,
      "ready_to_merge_counted": 2, "ready_to_merge_p50_seconds": 3600, "ready_to_merge_p95_seconds": 7200,
      "open_to_merge_p50_seconds": 43200, "open_to_merge_p95_seconds": 86400,
      "queue_counted": 2, "queue_p50_seconds": 1200, "queue_p95_seconds": 1800, "requeued": 1,
      "size_counted": 2, "size_p50_lines": 10,
      "bots_merged": 1, "bots_open": 1, "bots_merge_p50_seconds": 3600
    }
  ],
  "queue_exits": [{"repo": "bynk-lang/bynk", "reason": "CI_FAILURE", "count": 1}],
  "daily": [{"repo": "bynk-lang/bynk", "day": "2026-11-05", "merged": 1}]
}
```

Every figure but the `bots_` ones is for pull requests by people. Times are
nearest-rank percentiles in seconds, over pull requests merged in the window:

- **`ready_to_merge_*`** (the headline): `merged_at − ready_at`. A pull request
  whose ready time the service never saw is left out, and
  `ready_to_merge_counted` says how many of `merged` were counted.
- **`open_to_merge_*`**: `merged_at − opened_at`, over all of `merged`.
- **`queue_*`**: from the last `enqueued` before the merge to the merge, over
  those whose last queue moment before merging was that enqueue
  (`queue_counted`). One dequeued and then merged around the queue (by an
  admin, say) isn't counted, so its time out of the queue isn't either.
  `requeued` counts those enqueued more than once.
- **`size_p50_lines`**: the median of additions plus deletions, over those whose
  size is known (`size_counted`).
- **`closed_unmerged`**: closed without merging in the window.
- **`queue_exits`**: each reason a pull request left the merge queue without
  merging in the window (`MERGE` is the normal way out, so isn't listed;
  `unknown` when GitHub gave none).
- **`daily`**: merges by people per UTC day.
- **`data_since`**: the first merge recorded (in any repository), so a reader
  can tell a full window from a partly covered one (no backfill), as the CI
  route's first completion does.

`gone` pull requests count nowhere. Each query applies the visibility rule
(public, the `repo` filter, not in `DASHBOARD_EXCLUDE`) in one `shown` CTE.

## `GET /metrics/prs/open`

Every open pull request in public repositories (at most 500, after
`DASHBOARD_EXCLUDE` is applied), longest waiting first: ready ones by when they
last became ready (or opened, if that isn't known), then drafts.
`?repo=owner/name` narrows it. Cached and limited as above.

```json
{
  "open": [
    {
      "repo": "bynk-lang/bynk", "number": 2961, "title": "…", "author": "…", "author_is_bot": false,
      "stage": "ready", "opened_at": "2026-11-05T08:40:00.000Z", "ready_since": "2026-11-05T09:01:24.000Z",
      "stale": false
    }
  ]
}
```

- **`stage`**: `draft`, `queued` or `ready`. `queued` when its latest queue
  moment is an enqueue from the last day: a merge-queue run takes minutes, so
  an older one means the `dequeued` delivery was lost, and it reads as ready.
- **`ready_since`**: when it last became ready, so a draft made ready again
  waits from then. `null` for one that became ready before the service saw it.
- **`stale`**: ready for more than 7 days and not in the queue.

## The page

`/prs` is the PR flow page, linked to and from the CI health page at `/`, with
the same stylesheet, window choice (7, 30 or 90 days) and freshness line. For
each public repository it shows:

- **Tiles**: merged (and closed without merging), ready to merge, opened to
  merge, time in the merge queue (and how many were queued more than once),
  and median size. Each time gives its 95th percentile, and "ready to merge"
  says how many it counts when some became ready before recording began.
- **Why pull requests left the queue** without merging, and **bots'** figures,
  in a line each.
- **Merged per day**, a bar chart with its figures as a table.
- **Open now**: each open pull request (linked to GitHub) with its author, its
  stage (ready, in the queue, draft), how long it has waited, and a stale flag.

Like the CI page it polls (open pull requests every 30 seconds, the window's
figures every minute) and listens on the live feed, refetching both when the
event's `refetch_ms` says: 3 seconds after a change the Worker purged from the
edge cache, or 31 seconds when the purge was throttled (the same rule as the
CI page; see [ci-metrics.md](ci-metrics.md#live-feed)).

## Live feed

Pull requests share the CI page's live feed (`/live?board=ci`; see
[ci-metrics.md](ci-metrics.md#live-feed)). An event for a pull request has
`kind: "pull"`, the repository and `number`, its delivery's action as `status`
and its state as `conclusion`:

```json
{"refetch_ms": 3000, "kind": "pull", "repo": "bynk-lang/bynk", "number": 2961, "path": "",
 "workflow": "", "run_id": 0, "attempt": 0, "status": "ready_for_review", "conclusion": "open"}
```

It is sent for a delivery's first arrival only (a redelivery tells nothing
new), and only for a repository the public pages may show. Each page acts on
its own kind: the CI page ignores `pull` events, and this page ignores `run`
and `release` events. The releases page also acts on a `pull` event whose
pull request merged, since that changes what is waiting to ship.
