-- Phase 4, slice 3 (#36): the facts the releases dashboard reads, extracted
-- from `release` deliveries as they arrive. Kept indefinitely, like the other
-- facts tables. Times are ISO-8601 with milliseconds, so they compare as text.

-- One row per release, keyed by its tag: a release deleted and published
-- again for the same tag (a re-run release) is the same row.
CREATE TABLE releases (
  repo          TEXT    NOT NULL,             -- repository.full_name
  tag           TEXT    NOT NULL,             -- release.tag_name
  release_id    INTEGER NOT NULL,             -- GitHub's id, the latest seen for the tag
  name          TEXT,
  draft         INTEGER NOT NULL,             -- never shown: a draft isn't public
  prerelease    INTEGER NOT NULL,             -- shown, but ships nothing and isn't counted
  created_at    TEXT    NOT NULL,
  published_at  TEXT,                         -- null while a draft
  author_is_bot INTEGER NOT NULL,
  previous_tag  TEXT,                         -- the final release before it; null for a repository's first
  shipped       INTEGER,                      -- PRs it shipped; null until matched
  deleted_at    TEXT,                         -- when a `deleted` delivery arrived; cleared if published again
  PRIMARY KEY (repo, tag)
);

-- Which release first shipped each merged pull request (#36), matched by the
-- PR's merge commit among the commits between the previous release's tag and
-- the release's. The merge commit is recorded only once the PR has merged.
ALTER TABLE pull_requests ADD COLUMN merge_commit_sha TEXT;
ALTER TABLE pull_requests ADD COLUMN released_in TEXT;
ALTER TABLE pull_requests ADD COLUMN released_at TEXT;
