-- Phase 4, slice 5, step 3 (#48): whether an issue's author is a maintainer,
-- for `/metrics/issues`' outsider figures. GitHub's author association says
-- so for an owner, member or collaborator, but reports a member whose
-- membership is private as a `CONTRIBUTOR`. So for any other author who
-- isn't a bot, the issue's recorder (a delivery, or the daily sync) asks the
-- organisation, through the cached lookup commenters already use
-- (`org_members`), and keeps the answer on the row. `NULL` until it is known;
-- a lookup that fails leaves the row's last answer as it was.
ALTER TABLE issues ADD COLUMN author_maintainer INTEGER;
