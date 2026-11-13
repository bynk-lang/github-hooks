-- #103, step 2: whether a pull request's conversation is locked, from each
-- delivery and the daily sync. GitHub refuses a comment on a locked one with
-- a 403, so stale pull request nudges skip it. Rows recorded before this are
-- taken as unlocked until their next delivery or sync says otherwise.
ALTER TABLE pull_requests ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
