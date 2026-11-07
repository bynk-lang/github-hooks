-- Phase 4, slice 6, step 4 (#53): what the per-person view needs.
--
-- A pull request's head commit, so its CI is found by commit rather than by
-- branch name (a fork's `main` isn't the base repository's). Filled by
-- `pull_request` and `pull_request_review` deliveries and the daily sync.
ALTER TABLE pull_requests ADD COLUMN head_sha TEXT;

-- Whose review a pull request is waiting on: a user's login, or a team's
-- slug (`team` = 1). Replaced by a strictly newer delivery's whole set, and
-- added to or taken from by `review_requested` and `review_request_removed`,
-- as issue labels are (#48).
CREATE TABLE pull_request_review_requests (
  repo     TEXT    NOT NULL,
  number   INTEGER NOT NULL,
  reviewer TEXT    NOT NULL,
  team     INTEGER NOT NULL,
  PRIMARY KEY (repo, number, reviewer, team)
);

-- "Waiting on my review", "my open pull requests", "my open issues", and a
-- head commit's runs.
CREATE INDEX review_requests_by_reviewer ON pull_request_review_requests (reviewer COLLATE NOCASE) WHERE team = 0;
CREATE INDEX pull_requests_open_by_author ON pull_requests (author COLLATE NOCASE) WHERE state = 'open';
CREATE INDEX issues_open_by_author ON issues (author COLLATE NOCASE) WHERE state = 'open';
CREATE INDEX workflow_runs_by_sha ON workflow_runs (repo, sha);
