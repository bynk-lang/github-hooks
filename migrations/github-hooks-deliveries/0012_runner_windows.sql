-- Phase 4, slice 4, step 2 (#42): the runner-wait figures, computed hourly.
-- Jobs are ten times as many as runs (about 4,900 a day), so computing a
-- 90-day window per request would read about 440,000 rows each time; the
-- `runnerFigures` cron computes the 7, 30 and 90-day windows once an hour,
-- reading the 90 days once, and the route reads one row. Each list is the
-- JSON the route answers with, for every repository; which repositories are
-- shown is decided when the route reads, so a repository made private is
-- hidden at once.
CREATE TABLE runner_windows (
  days        INTEGER PRIMARY KEY,            -- 7, 30 or 90
  computed_at TEXT    NOT NULL,
  since       TEXT    NOT NULL,
  until       TEXT    NOT NULL,
  data_since  TEXT,                           -- the first job recorded
  runners     TEXT    NOT NULL,               -- JSON: [RunnerWait]
  longest     TEXT    NOT NULL,               -- JSON: [LongWait], 10 a repository
  slowest     TEXT    NOT NULL                -- JSON: [JobTime], 10 a repository
);

-- Each job's wait for a runner and its duration, in seconds, kept as indexed
-- generated columns so the figures never compute them row by row. Each figure
-- reads its own partial index in order, so nothing is sorted. Waits and
-- durations are counted by how many jobs had each value, and the percentiles
-- are read off the running totals: about 0.1 s for 90 days' 440,000 jobs,
-- where ranking every job took several seconds.
ALTER TABLE workflow_jobs ADD COLUMN wait_seconds INTEGER
  GENERATED ALWAYS AS (CAST(round((julianday(started_at) - julianday(created_at)) * 86400) AS INTEGER)) VIRTUAL;
ALTER TABLE workflow_jobs ADD COLUMN took_seconds INTEGER
  GENERATED ALWAYS AS (CAST(round((julianday(completed_at) - julianday(started_at)) * 86400) AS INTEGER)) VIRTUAL;

-- Waits that count (a runner took the job, not held for an approval, not
-- skipped), by repository and runner, for the waits by runner.
CREATE INDEX workflow_jobs_waits ON workflow_jobs (repo, runner, wait_seconds, started_at)
  WHERE wait_seconds IS NOT NULL AND approval = 0 AND conclusion IS NOT 'skipped';

-- The same waits by repository alone, for the longest: each repository's are
-- read from the longest down until enough fall in the window. `started_at`
-- is left out on purpose, so the planner can't skip-scan by it instead.
CREATE INDEX workflow_jobs_longest ON workflow_jobs (repo, wait_seconds)
  WHERE wait_seconds IS NOT NULL AND approval = 0 AND conclusion IS NOT 'skipped';

-- Successful jobs' durations, by repository, workflow and job, for the slowest.
CREATE INDEX workflow_jobs_took ON workflow_jobs (repo, workflow, name, took_seconds, started_at)
  WHERE took_seconds IS NOT NULL AND conclusion = 'success';
