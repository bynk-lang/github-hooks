-- #110, step 1: groundwork for release notes drafts (#69, slice 4).

-- Each pull request's labels, as its latest delivery or the daily sync says,
-- replaced whole each time one says them. Release notes are grouped with
-- them. `issue_labels` holds issues' alone.
CREATE TABLE pull_request_labels (
  repo   TEXT    NOT NULL,
  number INTEGER NOT NULL,
  label  TEXT    NOT NULL,
  PRIMARY KEY (repo, number, label)
);

-- A third kind of proposal, `release_notes`: notes for a published release's
-- description. Its payload is {"release_id": n, "tag": "...", "body": "..."},
-- and its target is the release's id. `proposals` is rebuilt to allow it, as
-- 0026 rebuilt it for `comment`, keeping every row, id and the sequence.
CREATE TABLE proposals_v3 (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repo         TEXT    NOT NULL COLLATE NOCASE,
  kind         TEXT    NOT NULL CHECK (kind IN ('labels', 'comment', 'release_notes')),
  target       INTEGER NOT NULL,            -- the issue or pull request number; a release's id
  title        TEXT,                        -- the target's title, or the release's name or tag
  payload      TEXT    NOT NULL,            -- JSON, by kind
  reason       TEXT    NOT NULL,
  proposed_at  TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('pending', 'approving', 'approved', 'declined', 'failed', 'expired')),
  decided_by   TEXT,
  decided_at   TEXT,
  outcome      TEXT
);

INSERT INTO proposals_v3 (id, repo, kind, target, title, payload, reason, proposed_at, expires_at, status, decided_by, decided_at, outcome)
SELECT id, repo, kind, target, title, payload, reason, proposed_at, expires_at, status, decided_by, decided_at, outcome FROM proposals;

DROP TABLE proposals;

ALTER TABLE proposals_v3 RENAME TO proposals;

CREATE INDEX proposals_status ON proposals (status, proposed_at);
CREATE INDEX proposals_decided ON proposals (decided_at);
