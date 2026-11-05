# CI metrics

Phase 4 (#20) of github-hooks: the health of the organisation's CI, built
from the `workflow_run` deliveries the service already receives. These routes
are **public**: no token. They show only repositories whose latest delivery
says they're public, less any named in `DASHBOARD_EXCLUDE`, and each answer is
cached for 30 seconds (`Cache-Control: public, max-age=30`).

There is no backfill: data starts when `workflow_runs` was deployed.
`data_since` says when, so a 30-day window with 3 days of data reads as that.

## `GET /metrics/ci`

Each workflow's health over a window, from its completed attempts, counted
by when they completed.

| Query | Meaning | Default |
|---|---|---|
| `repo` | `owner/name`, matched whatever its case | every public repository |
| `branch` | the run's head branch, as GitHub names it | every branch |
| `event` | what triggered the run: `push`, `pull_request`, `merge_group`, `schedule`, … | every trigger |
| `days` | how far back the window reaches, 1 to 90 | 7 |

A `repo` that isn't `owner/name`, or `days` outside 1 to 90, is `400` before
anything is read.

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
  success. `cancelled` and `skipped` runs don't change the state.

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
