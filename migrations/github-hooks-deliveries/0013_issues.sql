-- Phase 4, slice 5 (#48): the facts the issue-response figures read,
-- extracted from `issues` and `issue_comment` deliveries as they arrive (and,
-- from step 2, a daily sync of open issues). Kept indefinitely: retention
-- prunes `deliveries`, not these. Times are ISO-8601 with milliseconds, like
-- `received_at`, so they compare as text.

-- One row per issue. Every `issues` and `issue_comment` delivery carries the
-- whole issue, so any of them creates or refreshes the row; a delivery older
-- than the row (by `updated_at`) changes nothing. A deleted or transferred
-- issue keeps its row as a tombstone (`state` `deleted` or `transferred`),
-- so a late delivery can't bring it back; tombstones are counted nowhere.
CREATE TABLE issues (
  repo               TEXT    NOT NULL,        -- repository.full_name
  number             INTEGER NOT NULL,
  title              TEXT    NOT NULL,        -- the latest
  author             TEXT    NOT NULL,        -- user.login
  author_is_bot      INTEGER NOT NULL,        -- user.type = 'Bot'
  author_association TEXT    NOT NULL,        -- OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, …
  state              TEXT    NOT NULL,        -- open, closed, or (final) deleted or transferred
  state_reason       TEXT,                    -- completed, not_planned, duplicate, reopened
  opened_at          TEXT    NOT NULL,        -- created_at
  closed_at          TEXT,                    -- cleared by a reopen
  updated_at         TEXT    NOT NULL,        -- issue.updated_at of the latest delivery applied
  comments           INTEGER NOT NULL,        -- GitHub's count
  first_response_at  TEXT,                    -- the first comment by a maintainer (not the author, not a bot); only moves earlier
  first_responder    TEXT,
  PRIMARY KEY (repo, number)
);

-- Flow over a window: issues by when they were opened, and by when they closed.
CREATE INDEX issues_by_opened ON issues (opened_at);
CREATE INDEX issues_by_closed ON issues (closed_at) WHERE closed_at IS NOT NULL;

-- The open backlog: a few dozen rows at any moment.
CREATE INDEX issues_open ON issues (repo) WHERE state = 'open';

-- Each issue's current labels, replaced whenever its row is refreshed, for
-- the figures by label.
CREATE TABLE issue_labels (
  repo   TEXT    NOT NULL,
  number INTEGER NOT NULL,
  label  TEXT    NOT NULL,
  PRIMARY KEY (repo, number, label)
);
