-- Phase 4, slice 2 (#26): the facts the PR flow dashboard reads, extracted
-- from `pull_request` and `pull_request_review` deliveries as they arrive.
-- Kept indefinitely: retention prunes `deliveries`, not these. Times are
-- ISO-8601 with milliseconds, like `received_at`, so they compare as text.

-- One row per pull request. Every `pull_request` delivery carries the whole
-- PR, so any of them creates or refreshes the row; a delivery older than the
-- row (by `updated_at`) changes nothing but `ready_at`.
CREATE TABLE pull_requests (
  repo          TEXT    NOT NULL,             -- repository.full_name
  number        INTEGER NOT NULL,
  title         TEXT    NOT NULL,             -- the latest
  author        TEXT    NOT NULL,             -- user.login
  author_is_bot INTEGER NOT NULL,             -- user.type = 'Bot'
  base          TEXT    NOT NULL,             -- base.ref
  head          TEXT    NOT NULL,             -- head.ref
  draft         INTEGER NOT NULL,
  state         TEXT    NOT NULL,             -- open, merged or closed
  opened_at     TEXT    NOT NULL,             -- created_at
  ready_at      TEXT,                         -- opened ready: created_at; else the first ready_for_review. Only moves earlier.
  closed_at     TEXT,
  merged_at     TEXT,
  commits       INTEGER,                      -- GitHub's count, so redeliveries can't inflate it
  additions     INTEGER,
  deletions     INTEGER,
  changed_files INTEGER,
  updated_at    TEXT    NOT NULL,             -- pull_request.updated_at of the latest delivery applied
  PRIMARY KEY (repo, number)
);

-- Flow over a window: merged PRs by when they merged.
CREATE INDEX pull_requests_by_merged ON pull_requests (merged_at) WHERE merged_at IS NOT NULL;

-- "Open now": a handful of rows at any moment.
CREATE INDEX pull_requests_open ON pull_requests (repo) WHERE state = 'open';

-- The moments the row alone can't hold: each enqueue and dequeue (and why),
-- each move to and from draft, each close and reopen. Keyed by delivery, so
-- a redelivery records nothing new; `at` is when the delivery was received.
CREATE TABLE pull_request_events (
  delivery TEXT    PRIMARY KEY,               -- X-GitHub-Delivery
  repo     TEXT    NOT NULL,
  number   INTEGER NOT NULL,
  action   TEXT    NOT NULL,                  -- enqueued, dequeued, ready_for_review, converted_to_draft, closed, reopened
  reason   TEXT,                              -- dequeued's reason, when GitHub gives one
  at       TEXT    NOT NULL
);

CREATE INDEX pull_request_events_by_pr ON pull_request_events (repo, number, at);

-- Reviews, recorded but not shown yet (#26): today nearly every review comes
-- from the PR author's own account. Keyed by GitHub's review id.
CREATE TABLE pull_request_reviews (
  review_id       INTEGER PRIMARY KEY,
  repo            TEXT    NOT NULL,
  number          INTEGER NOT NULL,
  reviewer        TEXT,                       -- null for a deleted account
  reviewer_is_bot INTEGER NOT NULL,
  state           TEXT    NOT NULL,           -- approved, changes_requested, commented, dismissed
  submitted_at    TEXT
);

CREATE INDEX pull_request_reviews_by_pr ON pull_request_reviews (repo, number);
