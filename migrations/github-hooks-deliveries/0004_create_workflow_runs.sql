-- Phase 4 (#20): the facts the CI dashboard reads, one row per workflow run
-- attempt, extracted from `workflow_run` deliveries as they arrive. Kept
-- indefinitely: retention prunes `deliveries`, not this. A row is created by
-- the first delivery for an attempt and moved forward by later ones; it never
-- moves back (a late `in_progress` cannot overwrite `completed`).
--
-- Times are ISO-8601 with milliseconds (`2026-11-05T06:10:56.000Z`), the format
-- `received_at` uses, so they compare as text.
CREATE TABLE workflow_runs (
  repo         TEXT    NOT NULL,             -- repository.full_name
  run_id       INTEGER NOT NULL,             -- workflow_run.id
  attempt      INTEGER NOT NULL,             -- workflow_run.run_attempt
  workflow     TEXT    NOT NULL,             -- workflow_run.name
  path         TEXT    NOT NULL,             -- workflow_run.path, the stable grouping
  branch       TEXT,                         -- workflow_run.head_branch
  sha          TEXT    NOT NULL,             -- workflow_run.head_sha
  event        TEXT    NOT NULL,             -- what triggered it: push, pull_request, merge_group, …
  status       TEXT    NOT NULL,             -- requested, queued, waiting, in_progress, completed, …
  conclusion   TEXT,                         -- set once completed: success, failure, cancelled, …
  created_at   TEXT    NOT NULL,             -- the run's: a re-run keeps the original
  queued_at    TEXT    NOT NULL,             -- this attempt's: created_at, or a re-run's earliest delivery
  started_at   TEXT,                         -- run_started_at
  completed_at TEXT,                         -- updated_at of the completed delivery
  updated_at   TEXT    NOT NULL,             -- the latest delivery's workflow_run.updated_at
  PRIMARY KEY (repo, run_id, attempt)
);

-- Whether each repository is public, decided at read time: the public
-- dashboard joins this, so making a repository private hides its whole
-- history at once, not just runs from then on. Updated from every delivery
-- whose `repository` carries `private`; last arrival wins.
CREATE TABLE repositories (
  repo       TEXT    PRIMARY KEY,
  public     INTEGER NOT NULL,
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Metrics over a window: per repository and workflow, by completion time.
CREATE INDEX workflow_runs_by_completion ON workflow_runs (repo, path, completed_at);

-- "Now": the runs not yet completed, a handful at any moment.
CREATE INDEX workflow_runs_in_flight ON workflow_runs (repo) WHERE status != 'completed';
