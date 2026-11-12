-- #88, step 2: the App's proposals, and their place in the maintainers' audit.

-- What the App would do, waiting on a maintainer (#69). A feature records a
-- proposal; a maintainer approves or declines it in Mine. Approving claims it
-- (`pending` -> `approving`) in one statement, so it's acted on once, then
-- ends `approved`, or `failed` with GitHub's reason. A row left `approving`
-- is one whose Worker died before GitHub answered. A pending
-- proposal past `expires_at` is `expired`. Retention prunes decided ones 90
-- days after the decision; the decisions themselves stay in
-- `maintainer_actions`.
CREATE TABLE proposals (
  id           INTEGER PRIMARY KEY,
  repo         TEXT    NOT NULL COLLATE NOCASE,
  kind         TEXT    NOT NULL CHECK (kind IN ('labels')),
  target       INTEGER NOT NULL,            -- the issue or pull request number
  title        TEXT,                        -- the target's title when proposed
  payload      TEXT    NOT NULL,            -- JSON; for `labels`, {"labels": [...]}
  reason       TEXT    NOT NULL,            -- why, in the proposer's words
  proposed_at  TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('pending', 'approving', 'approved', 'declined', 'failed', 'expired')),
  decided_by   TEXT,
  decided_at   TEXT,
  outcome      TEXT                         -- what happened, in words
);

CREATE INDEX proposals_status ON proposals (status, proposed_at);
CREATE INDEX proposals_decided ON proposals (decided_at);

-- `maintainer_actions` (0018) was shaped for re-runs alone: `run_id` and
-- `attempt` were required. A decision on a proposal has neither, so the
-- table is rebuilt with both optional and a `proposal` column, keeping every
-- row and id. The claim index is unchanged: it only ever holds re-runs.
CREATE TABLE maintainer_actions_v2 (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  login    TEXT    NOT NULL,
  action   TEXT    NOT NULL,                -- rerun-failed-jobs, approve-proposal, decline-proposal
  repo     TEXT    NOT NULL,
  run_id   INTEGER,                         -- a re-run's run
  attempt  INTEGER,                         -- a re-run's attempt
  proposal INTEGER,                         -- a decision's proposal
  at       TEXT    NOT NULL,
  status   INTEGER,
  outcome  TEXT    NOT NULL,
  claimed  INTEGER NOT NULL
);

INSERT INTO maintainer_actions_v2 (id, login, action, repo, run_id, attempt, at, status, outcome, claimed)
SELECT id, login, action, repo, run_id, attempt, at, status, outcome, claimed FROM maintainer_actions;

DROP TABLE maintainer_actions;

ALTER TABLE maintainer_actions_v2 RENAME TO maintainer_actions;

CREATE UNIQUE INDEX maintainer_actions_claimed ON maintainer_actions (repo, run_id, attempt) WHERE claimed = 1;
