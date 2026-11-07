-- Phase 4, slice 6, step 5 (#53): maintainers' sessions and actions.
--
-- Each login's session version. A maintainer token's subject is
-- `login:version` (a plain login is version 0); signing out moves the login
-- to the next version, so every token issued before it is refused, on every
-- device, before it expires.
CREATE TABLE maintainer_sessions (
  login         TEXT    PRIMARY KEY COLLATE NOCASE,
  version       INTEGER NOT NULL,
  signed_out_at TEXT    NOT NULL
);

-- Every action a maintainer takes from the dashboard, and GitHub's answer:
-- who, what, on which run attempt, when. Kept indefinitely, as an audit.
-- `status` is GitHub's HTTP status, or NULL when GitHub couldn't be reached.
CREATE TABLE maintainer_actions (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  login   TEXT    NOT NULL,
  action  TEXT    NOT NULL,                   -- rerun-failed-jobs
  repo    TEXT    NOT NULL,
  run_id  INTEGER NOT NULL,
  attempt INTEGER NOT NULL,                   -- the attempt that was re-run
  at      TEXT    NOT NULL,
  status  INTEGER,
  outcome TEXT    NOT NULL
);

-- "Has this attempt already been re-run?", per run.
CREATE INDEX maintainer_actions_by_run ON maintainer_actions (repo, run_id, attempt);
