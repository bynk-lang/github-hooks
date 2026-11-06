# Runner wait

The fourth slice of the public dashboard
([#42](https://github.com/bynk-lang/github-hooks/issues/42)): how long jobs
wait for a runner, on which runners, and which jobs are slowest. GitHub queues
for runners per job, not per run: a run's `run_started_at` equals its
`created_at` while its jobs wait, so the CI health figures can't see it. This
page covers what is recorded, how long it's kept, the routes, and the section
on the CI health page.

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
| `slowest` | each repository's 10 slowest jobs by median duration, among those with at least 3 successful runs: `runs`, `p50_seconds`, `p95_seconds` |

A wait is `started_at − created_at`, over jobs that started in the window,
leaving out skipped jobs and jobs held for an approval. A duration is
`completed_at − started_at`, over successful jobs. Percentiles are nearest
rank.

**Computed hourly, not per request.** Jobs are ten times as many as runs, so a
90-day window computed per request would read about 440,000 rows every time
the cache missed. Instead the `runnerFigures` cron (`37 * * * *`) computes all
three windows for every repository and stores them in `runner_windows`
(migration `0012`), one row a window; the route reads one row and filters it.

- **Time:** D1 runs one query at a time per database, so a slow computation
  would hold up the deliveries that arrive while it runs (GitHub allows a
  delivery 10 s). So the run never ranks jobs row by row:
  - **Stored values:** a job's wait and duration are generated columns
    (`wait_seconds`, `took_seconds`, migration `0012`), each in its own partial
    index: the waits that count by repository and runner; the same by
    repository alone; and successful jobs' durations by repository, workflow
    and job.
  - **Waits and slowest:** these read their index in order and count jobs by
    each wait or duration, per window, so nothing is sorted. The percentiles
    are read off the running totals.
  - **Longest:** this reads each repository's waits from the longest down,
    until 10 fall in the window.

  At 90 days' volume (440,000 jobs, seeded into the local D1 under
  `bynk dev`), a whole run takes about 0.3 s, writes included. Ranking every
  job, as the first version did, took about 9 s in memory for the three
  queries alone.
- **Cost:** the waits and slowest-jobs queries each scan their index once,
  about 850,000 rows read an hour, roughly 0.6 billion a month. That's inside
  the Workers Paid plan's 25 billion a month. Each job delivery writes the
  three indexes too.
- **Slowest jobs:** a job needs 3 successful runs in the window to be ranked
  (`SLOWEST_MIN_RUNS`). One run is one sample, and a one-off job would top
  the list on it.
- **Freshness:** the figures are at most an hour old; `computed_at` says how
  old.
- **Failure:** if a computation fails, it's logged and the previous figures
  stay.

D1 refuses a statement given more parameters than its SQL uses ("Wrong number
of parameter bindings"), but the in-memory D1 the suites run against doesn't
(bynk-lang/bynk#3003). So each query gets exactly its own parameters: the
waits the four window bounds; the longest waits those and the list length; and
the slowest jobs those and the minimum number of runs.

### `GET /metrics/runners/now?repo=owner/name`

What is waiting now, by repository and runner label: `queued` (with
`oldest_queued_at`) and `awaiting_approval`. It's read live from the partial
index `workflow_jobs_waiting`, a handful of rows at any moment. A job queued
more than 24 hours ago (`JOB_QUEUE_TIMEOUT`) isn't counted: it lost its later
deliveries.

## On the CI health page

Each repository's card on `/` has a **Waiting for runners** block under its
workflows, for the window chosen at the top (7, 30 or 90 days):

- **Waits by runner label:** jobs, median and 95th percentile wait, and the
  longest. A range from the median to the 95th percentile is drawn on a scale
  shared by the repository's runners; the figures beside it carry the values.
- **Waiting now:** in the same row, jobs queued for that label (with the
  oldest one's age) and jobs held for an approval. A label with only waiting
  jobs is listed after the rest.
- **Longest waits:** the window's 10, folded away by default, each linking to
  its job on GitHub.
- **When:** a note says when the figures were last computed, and how far back
  job data goes if it doesn't yet cover the window.

Each workflow's trend panel lists its jobs among the repository's **slowest
jobs**, matched by workflow name: a job delivery names its workflow but not
the workflow's file. So two workflow files with the same `name:` in one
repository would each list the other's jobs too.

Jobs have no live feed, so the block polls, live or not: what's waiting now
every 30 seconds, and the window's figures every minute (they change hourly,
and the edge caches each for 30 seconds). Each source has its own entry in the
page's freshness line, so a failing one shows as stale while the rest carry
on.
