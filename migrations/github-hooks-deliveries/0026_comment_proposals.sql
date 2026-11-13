-- #103, step 1: a second kind of proposal, `comment`: a comment the App would
-- post on an issue or pull request (stale pull request nudges, #69 slice 3).
-- Its payload is {"body": "...", "wait_since": "..."}, `wait_since` being the
-- start of the wait a nudge is for.
--
-- SQLite can't change a CHECK constraint in place, so `proposals` is rebuilt
-- with `comment` allowed, keeping every row and id, and its indexes are
-- recreated. `claude_calls.proposal` and `maintainer_actions.proposal` refer
-- to proposals by id, which the copy keeps.
CREATE TABLE proposals_v2 (
  id           INTEGER PRIMARY KEY,
  repo         TEXT    NOT NULL COLLATE NOCASE,
  kind         TEXT    NOT NULL CHECK (kind IN ('labels', 'comment')),
  target       INTEGER NOT NULL,            -- the issue or pull request number
  title        TEXT,                        -- the target's title when proposed
  payload      TEXT    NOT NULL,            -- JSON; `labels`: {"labels": [...]}; `comment`: {"body": "...", "wait_since": "..."}
  reason       TEXT    NOT NULL,            -- why, in the proposer's words
  proposed_at  TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('pending', 'approving', 'approved', 'declined', 'failed', 'expired')),
  decided_by   TEXT,
  decided_at   TEXT,
  outcome      TEXT                         -- what happened, in words
);

INSERT INTO proposals_v2 (id, repo, kind, target, title, payload, reason, proposed_at, expires_at, status, decided_by, decided_at, outcome)
SELECT id, repo, kind, target, title, payload, reason, proposed_at, expires_at, status, decided_by, decided_at, outcome FROM proposals;

DROP TABLE proposals;

ALTER TABLE proposals_v2 RENAME TO proposals;

CREATE INDEX proposals_status ON proposals (status, proposed_at);
CREATE INDEX proposals_decided ON proposals (decided_at);
