-- #88, step 1: the Claude capability's daily caps and its record of calls.

-- Calls claimed per repository per UTC day. A call is claimed here before it
-- is made, in one statement that also checks the repository's cap and the
-- day's total across repositories (`claimClaudeCall`); a call that gets no
-- answer from Anthropic gives its claim back. Retention keeps a week.
CREATE TABLE claude_calls_daily (
  repo  TEXT NOT NULL COLLATE NOCASE,
  day   TEXT NOT NULL,              -- YYYY-MM-DD, UTC
  calls INTEGER NOT NULL,
  PRIMARY KEY (repo, day)
);

CREATE INDEX claude_calls_daily_day ON claude_calls_daily (day);

-- One row per call asked for, made or not: what it was for, the model asked
-- and the model that answered, how it stopped, what it cost in tokens
-- (summed over every attempt, a declined one too), and its outcome.
-- `proposal` links the proposal it made (#88, step 2).
-- Retention keeps 90 days.
CREATE TABLE claude_calls (
  id                          INTEGER PRIMARY KEY,
  at                          TEXT NOT NULL,
  repo                        TEXT NOT NULL COLLATE NOCASE,
  feature                     TEXT NOT NULL,
  model                       TEXT NOT NULL,   -- the model asked
  served_model                TEXT,            -- the model that answered, if one did
  outcome                     TEXT NOT NULL CHECK (outcome IN ('answered', 'refused', 'truncated', 'capped', 'failed')),
  status                      INTEGER,         -- the HTTP status, if Anthropic answered
  stop_reason                 TEXT,
  refusal_category            TEXT,
  detail                      TEXT,            -- why it failed or was capped
  input_tokens                INTEGER,
  output_tokens               INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens     INTEGER,
  fell_back                   INTEGER,         -- 1 when Opus's fallback model answered
  proposal                    INTEGER
);

CREATE INDEX claude_calls_at ON claude_calls (at);
CREATE INDEX claude_calls_repo_at ON claude_calls (repo, at);
