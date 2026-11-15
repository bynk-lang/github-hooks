-- #119, step 1: groundwork for the weekly summary (#69, slice 5).

-- A fourth kind of proposal, `discussion`: a post to a repository's
-- Discussions. Its payload is {"week": "YYYY-MM-DD", "category": "...",
-- "title": "...", "body": "..."}, and its target is the week's Monday as
-- yyyymmdd, so a repository has one per week. `proposals` is rebuilt to allow
-- it, as 0028 rebuilt it for `release_notes`, keeping every row and id.
--
-- The new table's AUTOINCREMENT sequence starts from the highest id copied,
-- not the old table's sequence: the two are the same unless the proposal with
-- the highest id ever has been pruned, which retention does 90 days after a
-- decision. The first proposals were made on 13 November 2026, so none has
-- been when this runs.
CREATE TABLE proposals_v4 (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repo         TEXT    NOT NULL COLLATE NOCASE,
  kind         TEXT    NOT NULL CHECK (kind IN ('labels', 'comment', 'release_notes', 'discussion')),
  target       INTEGER NOT NULL,            -- the issue or pull request number; a release's id; a week's Monday, yyyymmdd
  title        TEXT,                        -- the target's title; the release's name or tag; the post's title
  payload      TEXT    NOT NULL,            -- JSON, by kind
  reason       TEXT    NOT NULL,
  proposed_at  TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('pending', 'approving', 'approved', 'declined', 'failed', 'expired')),
  decided_by   TEXT,
  decided_at   TEXT,
  outcome      TEXT
);

INSERT INTO proposals_v4 (id, repo, kind, target, title, payload, reason, proposed_at, expires_at, status, decided_by, decided_at, outcome)
SELECT id, repo, kind, target, title, payload, reason, proposed_at, expires_at, status, decided_by, decided_at, outcome FROM proposals;

DROP TABLE proposals;

ALTER TABLE proposals_v4 RENAME TO proposals;

CREATE INDEX proposals_status ON proposals (status, proposed_at);
CREATE INDEX proposals_decided ON proposals (decided_at);
