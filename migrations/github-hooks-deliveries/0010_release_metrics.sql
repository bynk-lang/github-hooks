-- Phase 4, slice 3, step 3 (#36): what the public releases routes search by,
-- chosen with EXPLAIN QUERY PLAN.

-- Merge to release over a window: pull requests by when a release shipped them.
CREATE INDEX pull_requests_by_released ON pull_requests (released_at) WHERE released_at IS NOT NULL;

-- Waiting to ship: a repository's merged pull requests no release has shipped,
-- by when they merged.
CREATE INDEX pull_requests_unreleased ON pull_requests (repo, merged_at)
  WHERE merged_at IS NOT NULL AND released_in IS NULL;
