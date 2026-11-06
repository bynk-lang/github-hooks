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
