-- Phase 4, slice 4 (#42): the facts the runner-wait figures read, extracted
-- from `workflow_job` deliveries as they arrive. A job's wait for a runner is
-- `started_at - created_at`; GitHub queues per job, so runs alone can't say.
-- Times are ISO-8601 with milliseconds, like `received_at`, so they compare
-- as text.

-- One row per job attempt (a re-run's jobs have new ids), kept 90 days: the
-- retention cron rolls each day up into `workflow_job_days` before pruning it.
-- The row only moves forward (queued/waiting < in_progress < completed).
CREATE TABLE workflow_jobs (
  job_id       INTEGER PRIMARY KEY,           -- workflow_job.id
  repo         TEXT    NOT NULL,              -- repository.full_name
  run_id       INTEGER NOT NULL,
  attempt      INTEGER NOT NULL,              -- run_attempt
  workflow     TEXT    NOT NULL,              -- workflow_name
  name         TEXT    NOT NULL,
  runner       TEXT    NOT NULL,              -- the first label asked for: ubuntu-latest, self-hosted, …
  runner_group TEXT,                          -- once a runner takes it
  status       TEXT    NOT NULL,              -- queued, waiting, in_progress, completed
  approval     INTEGER NOT NULL DEFAULT 0,    -- it waited for a protected environment's approval; never cleared
  conclusion   TEXT,                          -- success, failure, cancelled, skipped, …
  created_at   TEXT    NOT NULL,              -- when it was queued
  started_at   TEXT,                          -- when a runner took it; null until then, and for one no runner took
  completed_at TEXT
);

-- Waits and durations over a window, by when the job started.
CREATE INDEX workflow_jobs_by_started ON workflow_jobs (started_at) WHERE started_at IS NOT NULL;

-- What is waiting now: a handful of rows at any moment.
CREATE INDEX workflow_jobs_waiting ON workflow_jobs (repo) WHERE status IN ('queued', 'waiting');

-- Retention takes the oldest day, and rolls it up and prunes it by its range.
CREATE INDEX workflow_jobs_by_created ON workflow_jobs (created_at);

-- Each day's jobs by repository, workflow, job and runner, rolled up from
-- `workflow_jobs` before its rows are pruned, and kept indefinitely. Skipped
-- jobs aren't counted. `waited` jobs started on a runner without waiting for
-- an approval (their wait is a wait for a runner); `gated` jobs waited for a
-- protected environment's approval, and their wait isn't counted;
-- `succeeded` jobs have a duration. The sums give means over many days; the
-- medians and 95th percentile are the day's own (nearest rank).
CREATE TABLE workflow_job_days (
  repo                 TEXT    NOT NULL,
  day                  TEXT    NOT NULL,      -- YYYY-MM-DD, UTC, by created_at
  workflow             TEXT    NOT NULL,
  name                 TEXT    NOT NULL,
  runner               TEXT    NOT NULL,
  jobs                 INTEGER NOT NULL,
  failed               INTEGER NOT NULL,      -- failure or timed_out
  gated                INTEGER NOT NULL,
  waited               INTEGER NOT NULL,
  wait_sum_seconds     INTEGER NOT NULL,
  wait_p50_seconds     INTEGER,
  wait_p95_seconds     INTEGER,
  succeeded            INTEGER NOT NULL,
  duration_sum_seconds INTEGER NOT NULL,
  duration_p50_seconds INTEGER,
  PRIMARY KEY (repo, day, workflow, name, runner)
);
