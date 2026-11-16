-- #129, step 1: groundwork for pull request reviews.

-- Each review the App runs, or was asked for: one per pull request each time
-- it becomes ready. `delivery` is the delivery that asked, so a redelivery
-- doesn't ask twice. `head_sha` is the commit it reviews. `status` moves
-- from `queued` to `running`, and ends `posted`, `superseded` (the head moved
-- and its findings no longer applied), `skipped` (closed, a draft again, too
-- large, or a bot's), `unwritten` (Claude declined, was cut off, or didn't
-- finish) or `failed`, with `detail` saying why. Retention keeps them as long
-- as deliveries.
CREATE TABLE reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo          TEXT    NOT NULL COLLATE NOCASE,
  number        INTEGER NOT NULL,
  head_sha      TEXT    NOT NULL,
  delivery      TEXT    UNIQUE,
  requested_at  TEXT    NOT NULL,
  started_at    TEXT,
  finished_at   TEXT,
  status        TEXT    NOT NULL CHECK (status IN ('queued', 'running', 'posted', 'superseded', 'skipped', 'unwritten', 'failed')),
  detail        TEXT,
  review_id     INTEGER,                    -- GitHub's id for the posted review
  findings      INTEGER,                    -- findings Claude made
  inline        INTEGER,                    -- of those, posted as inline comments
  resolved      INTEGER,                    -- earlier threads the App resolved
  turns         INTEGER                     -- requests to Claude
);

CREATE INDEX reviews_pull ON reviews (repo, number);
CREATE INDEX reviews_requested ON reviews (requested_at);

-- Reviews claimed per repository per UTC day, against their own caps: a
-- review makes many requests to Claude, which don't spend the per-call caps
-- in `claude_calls_daily`. Retention keeps a week.
CREATE TABLE claude_reviews_daily (
  repo     TEXT    NOT NULL COLLATE NOCASE,
  day      TEXT    NOT NULL,              -- YYYY-MM-DD, UTC
  reviews  INTEGER NOT NULL,
  PRIMARY KEY (repo, day)
);

CREATE INDEX claude_reviews_daily_day ON claude_reviews_daily (day);

-- Each request a review makes to Claude is recorded in `claude_calls` with
-- its review, as a proposal's call is with its proposal.
ALTER TABLE claude_calls ADD COLUMN review INTEGER;
