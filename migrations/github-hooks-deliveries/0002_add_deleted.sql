-- Whether a `push` deleted its branch or tag (GitHub's `deleted` flag): 1 for a
-- deleting push, 0 for any other push, NULL for every other event and for
-- rows recorded before this column existed. Nullable, so the code before this
-- migration keeps working against the new schema (expand, then contract).
ALTER TABLE deliveries ADD COLUMN deleted INTEGER;

-- Activity across all repositories, newest first (GET /activity), and one
-- day's deliveries as a range (GET /digest/:day).
CREATE INDEX deliveries_by_time ON deliveries (received_at);
