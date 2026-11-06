-- #57: forget every "not a member" answer kept so far. They came from GitHub's
-- "check membership" endpoint, which answers 404 when it won't show a private
-- membership, so private members were kept as outsiders. Each login is asked
-- again, of the membership endpoint, the next time it matters; the daily issue
-- sync then corrects open issues' `author_maintainer`.
DELETE FROM org_members WHERE member = 0;
