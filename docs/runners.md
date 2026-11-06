# Runner wait

The fourth slice of the public dashboard
([#42](https://github.com/bynk-lang/github-hooks/issues/42)): how long jobs
wait for a runner, on which runners, and which jobs are slowest. GitHub queues
for runners per job, not per run: a run's `run_started_at` equals its
`created_at` while its jobs wait, so the CI health figures can't see it. This
page covers what is recorded and how long it's kept. The routes and the section
on the CI health page follow in later steps.

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
  - **`started_at`:** set only once the job is `in_progress`. A `queued`
    delivery carries `created_at` in that field, which would make every wait
    zero. A job's wait for a runner is `started_at − created_at`.
  - **Skipped jobs:** kept, but counted nowhere.
  - **Steps:** not kept.
- **`workflow_job_days`**: each day's jobs by repository, workflow, job and
  runner, kept indefinitely. It holds:
  - the number of jobs and failures;
  - how many started (`waited`), the sum, median and 95th percentile of their
    waits;
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
