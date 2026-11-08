-- #68, step 2: review requests stay right when GitHub's deliveries arrive out
-- of order. A `review_request_removed`, or a submitted review, that arrives
-- before the `review_requested` it undoes used to delete nothing, and the
-- request was then added and stayed until a newer delivery or the daily sync.
--
-- When each request was made, as far as the service knows: the `updated_at`
-- of the delivery that made it (or of the set that listed it). NULL for rows
-- recorded before this migration, which any removal or review may delete.
ALTER TABLE pull_request_review_requests ADD COLUMN requested_at TEXT;

-- The latest removal of each request, by a `review_request_removed` (at the
-- pull request's `updated_at`) or by the reviewer's submitted review (at its
-- `submitted_at`). A request made no later than its tombstone isn't added, so
-- a removal that arrived first still wins. A set that lists the pull
-- request's requests as of a moment clears the tombstones it supersedes;
-- retention prunes those older than a day, by when any delivery they guard
-- against has arrived.
CREATE TABLE pull_request_review_tombstones (
  repo     TEXT    NOT NULL,
  number   INTEGER NOT NULL,
  reviewer TEXT    NOT NULL COLLATE NOCASE,
  team     INTEGER NOT NULL,
  at       TEXT    NOT NULL,
  PRIMARY KEY (repo, number, reviewer, team)
);

CREATE INDEX pull_request_review_tombstones_by_at ON pull_request_review_tombstones (at);
