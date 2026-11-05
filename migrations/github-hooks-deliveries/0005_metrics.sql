-- Phase 4, step 2 (#20): what the CI metrics read.

-- A repository's default branch, from the same deliveries as `public`, so
-- "red on main" follows each repository's own default rather than assuming
-- `main`. NULL until a delivery that carries it arrives.
ALTER TABLE repositories ADD COLUMN default_branch TEXT;

-- Organisation-wide windows ("every run completed in the last 7 days") filter
-- on completion time alone; the per-repository index leads with `repo`.
CREATE INDEX workflow_runs_by_completed ON workflow_runs (completed_at);
