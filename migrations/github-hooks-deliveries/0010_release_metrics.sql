-- Phase 4, slice 3, step 3 (#36): what the public releases routes search by,
-- chosen with EXPLAIN QUERY PLAN.

-- Merge to release over a window: pull requests by when a release shipped them.
CREATE INDEX pull_requests_by_released ON pull_requests (released_at) WHERE released_at IS NOT NULL;

-- Waiting to ship: a repository's merged pull requests no release has shipped,
-- by when they merged.
CREATE INDEX pull_requests_unreleased ON pull_requests (repo, merged_at)
  WHERE merged_at IS NOT NULL AND released_in IS NULL;

-- Which PRs each release shipped, for its count of PRs by people.
CREATE INDEX pull_requests_by_release ON pull_requests (repo, released_in) WHERE released_in IS NOT NULL;

-- Tags pushed to each repository, from `push` deliveries (`ref` is
-- `refs/tags/<tag>`): a workflow run names its ref without saying whether it
-- is a branch or a tag, so this says which runs were for tags. Kept
-- indefinitely, like the other facts; the first push of a tag is kept.
CREATE TABLE tags (
  repo      TEXT NOT NULL,                    -- repository.full_name
  tag       TEXT NOT NULL,
  pushed_at TEXT NOT NULL,                    -- when the push delivery arrived
  PRIMARY KEY (repo, tag)
);
