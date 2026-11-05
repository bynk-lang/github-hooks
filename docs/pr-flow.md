# PR flow

The second slice of the public dashboard
([#26](https://github.com/bynk-lang/github-hooks/issues/26)): how long pull
requests take to land, what is open now, and how the merge queue behaves. This
page covers what is recorded, how it is kept correct, and the public routes
that read it; the page comes next.

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
  those seen enqueued (`queue_counted`). `requeued` counts those enqueued more
  than once.
- **`size_p50_lines`**: the median of additions plus deletions, over those whose
  size is known (`size_counted`).
- **`closed_unmerged`**: closed without merging in the window.
- **`queue_exits`**: each reason a pull request left the merge queue without
  merging in the window (`MERGE` is the normal way out, so isn't listed;
  `unknown` when GitHub gave none).
- **`daily`**: merges by people per UTC day.
- **`data_since`**: when the first pull request moment was recorded, so a
  reader can tell a full window from a partly covered one (no backfill).

`gone` pull requests count nowhere.

## `GET /metrics/prs/open`

Every open pull request in public repositories (at most 500), longest waiting
first: by when it became ready, or opened if that isn't known.
`?repo=owner/name` narrows it. Cached and limited as above.

```json
{
  "open": [
    {
      "repo": "bynk-lang/bynk", "number": 2961, "title": "…", "author": "…", "author_is_bot": false,
      "stage": "ready", "opened_at": "2026-11-05T08:40:00.000Z", "ready_at": "2026-11-05T09:01:24.000Z",
      "stale": false
    }
  ]
}
```

- **`stage`**: `draft`, `queued` (its latest queue moment is an enqueue) or
  `ready`.
- **`stale`**: ready for more than 7 days and not in the queue.
- **`ready_at`**: `null` for one that became ready before the service saw it.
