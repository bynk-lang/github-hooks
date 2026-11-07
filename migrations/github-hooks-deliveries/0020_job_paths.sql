-- v0.2.0 (#62): each job keeps its workflow's file, so the slowest jobs are
-- grouped by it without joining every job to its run. A job delivery names
-- its workflow but not the file, so the path comes from the run: a job takes
-- it from its run's row when it's recorded, and a run that's recorded after
-- its jobs fills it in on them. Null until the run is recorded, and for a job
-- whose run never is; the dashboard then matches it by workflow name.
ALTER TABLE workflow_jobs ADD COLUMN path TEXT;

-- The jobs already recorded take their runs' files.
UPDATE workflow_jobs SET path = (
  SELECT r.path FROM workflow_runs r
  WHERE r.repo = workflow_jobs.repo AND r.run_id = workflow_jobs.run_id AND r.attempt = workflow_jobs.attempt
);

-- The jobs still waiting for their run's file, by run: a run's delivery fills
-- in its own jobs without reading the table.
CREATE INDEX workflow_jobs_pathless ON workflow_jobs (repo, run_id, attempt) WHERE path IS NULL;

-- The slowest jobs' index, with the file, so the grouping reads it in order.
DROP INDEX workflow_jobs_took;
CREATE INDEX workflow_jobs_took ON workflow_jobs (repo, workflow, name, path, took_seconds, started_at)
  WHERE took_seconds IS NOT NULL AND conclusion = 'success';
