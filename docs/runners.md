# Runner wait

The fourth slice of the public dashboard
([#42](https://github.com/bynk-lang/github-hooks/issues/42)): how long jobs
wait for a runner, on which runners, and which jobs are slowest. GitHub queues
for runners per job, not per run: a run's `run_started_at` equals its
`created_at` while its jobs wait, so the CI health figures can't see it. This
page covers what is recorded, how long it's kept, and the routes. The section
on the CI health page follows in a later step.

## Before it records anything

The App must be subscribed to **Workflow job** events. They come under the
**Actions** permission, which the App already has, but the event itself has
to be ticked in the App's settings (**Permissions & events → Subscribe to
events**).

They are the busiest events by far: about 4,900 `bynk` jobs a day, each sending
`queued`, `in_progress` and `completed`. That's about 15,000 deliveries a day,
against about 3,200 of every other kind together. Each one costs two D1 writes:
the delivery and the job's row. The repository's visibility is only written
when it changes.

## What is recorded

Migration `0011` adds two tables:

- **`workflow_jobs`**: one row per job attempt (a re-run's jobs have new ids),
  from `workflow_job` deliveries.
  - **Ordering:** the row only moves forward (`queued`/`waiting` <
    `in_progress` < `completed`). A delivery as far along fills in what it
    knows, so a late `in_progress` never undoes `completed`, and a redelivery
    changes nothing.
  - **`runner`:** the first label the job asked for (`ubuntu-latest`,
    `self-hosted`, …), or `unknown` for none. `runner_group` is known once a
    runner takes the job, and a later delivery that names none keeps it.
  - **`started_at`:** set only once a runner has taken the job (in progress
    or completed, with a runner id). A `queued` delivery carries `created_at`
    in that field, and so does a job cancelled before any runner took it
    (8 of 1,069 sampled `bynk` jobs). Either would read as a zero wait. A job's
    wait for a runner is `started_at − created_at`.
  - **`approval`:** set when a `waiting` delivery says the job was held for a
    protected environment's approval, whenever it arrives, and never cleared.
    Such a job's `started_at − created_at` includes a person's approval time,
    not just a wait for a runner, so the figures leave its wait out.
  - **Skipped jobs:** kept, but counted nowhere.
  - **Steps:** not kept.
- **`workflow_job_days`**: each day's jobs by repository, workflow, job and
  runner, kept indefinitely. It holds:
  - the number of jobs and failures, and how many waited for an approval
    (`gated`);
  - how many waited for a runner (`waited`: started on one, not gated), and the
    sum, median and 95th percentile of their waits;
  - how many succeeded, and the sum and median of their durations.

  Skipped jobs aren't counted. Days are UTC, by when the job was queued.

## How long it's kept

The hourly `retention` cron:

- deletes `workflow_job` deliveries after 7 days, whatever their action, in the
  same batched `DELETE` as `workflow_run` progress. The job's row holds what
  matters, so `deliveries` stays at about 100,000 job rows rather than 1.35
  million;
- rolls up the oldest UTC day of `workflow_jobs` older than 90 days (the
  longest window) into `workflow_job_days`, then prunes that day's rows.
  Both happen in one D1 batch, so a day is never pruned without its rollup.
  It's one day a run, about 5,000 rows, so `workflow_jobs` stays at about
  450,000 rows.

A rollup is kept once it's written, so a job delivered late for a day already
rolled up is pruned without changing it. The log line says which day was rolled
up, such as `…, and rolled up and pruned 4,870 jobs of 2026-08-05`.

## Routes

Both are public, unauthenticated, `@cache(maxAge: 30.seconds, scope: public)`
and share the metrics rate limit, as the other metrics routes do
([docs](ci-metrics.md)). They cover public repositories less
`DASHBOARD_EXCLUDE`, decided as the route reads, so a repository made private
is hidden at once.

### `GET /metrics/runners?days=7&repo=owner/name`

The figures over a window of 7 (the default), 30 or 90 days; any other `days`
is a 400. `repo` is optional, and matched without regard to case.

| Field | What it is |
|---|---|
| `since`, `until` | the window, as the last computation took it |
| `computed_at` | when the figures were computed; `null` before the first run |
| `data_since` | when the first job was recorded, so a window longer than the data says so |
| `runners` | each repository's waits by runner label: `jobs`, `p50_seconds`, `p95_seconds`, `longest_seconds` |
| `longest` | each repository's 10 longest waits: job, workflow, runner, `wait_seconds`, `queued_at`, and a link to the job |
| `slowest` | each repository's 10 slowest jobs by median duration: `runs`, `p50_seconds`, `p95_seconds` |

A wait is `started_at − created_at`, over jobs that started in the window,
leaving out skipped jobs and jobs held for an approval. A duration is
`completed_at − started_at`, over successful jobs. Percentiles are nearest
rank.

**Computed hourly, not per request.** Jobs are ten times as many as runs, so a
90-day window computed per request would read about 440,000 rows every time
the cache missed. Instead the `runnerFigures` cron (`37 * * * *`) computes all
three windows for every repository and stores them in `runner_windows`
(migration `0012`), one row a window; the route reads one row and filters it.

- **Cost:** each of its three queries reads the 90 days once, through
  `workflow_jobs_by_started`, and tags each job with the windows it falls in.
  That's about 1.3 million rows read an hour, roughly 1 billion a month. That's
  inside the Workers Paid plan's 25 billion a month.
- **Freshness:** the figures are at most an hour old; `computed_at` says how
  old.
- **Failure:** if a computation fails, it's logged and the previous figures
  stay.

D1 refuses a statement given more parameters than its SQL uses ("Wrong number
of parameter bindings"), but the in-memory D1 the suites run against doesn't
(bynk-lang/bynk#3003). So the waits query gets the four window bounds alone,
and the two lists get the bounds plus the list length.

### `GET /metrics/runners/now?repo=owner/name`

What is waiting now, by repository and runner label: `queued` (with
`oldest_queued_at`) and `awaiting_approval`. It's read live from the partial
index `workflow_jobs_waiting`, a handful of rows at any moment. A job queued
more than 24 hours ago (`JOB_QUEUE_TIMEOUT`) isn't counted: it lost its later
deliveries.
