-- Phase 4, slice 5, step 3 (#48): `/metrics/issues` asks, for each issue in
-- the window, whether its author is a confirmed member of the organisation
-- (by lower-case login, any organisation). `org_members` is keyed by
-- `(org, login)`, so without this each check would scan the table.
CREATE INDEX org_members_by_login ON org_members (login) WHERE member = 1;
