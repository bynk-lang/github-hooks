-- #88, step 3: what each repository's `.github/bynk-hooks.yml` said when the
-- App last read it, so Mine can explain a file it refused, or keys it
-- ignored. The settings themselves are cached in KV (`settings:<repo>`), not
-- here; this row is rewritten each time the file is read from GitHub.
CREATE TABLE repo_settings (
  repo     TEXT PRIMARY KEY COLLATE NOCASE,
  read_at  TEXT NOT NULL,
  state    TEXT NOT NULL CHECK (state IN ('missing', 'decoded', 'invalid', 'unreadable')),
  detail   TEXT,                            -- invalid: the decoder's reason; unreadable: GitHub's answer
  unknown  TEXT NOT NULL DEFAULT '[]'       -- JSON list of the keys the App ignored
);
