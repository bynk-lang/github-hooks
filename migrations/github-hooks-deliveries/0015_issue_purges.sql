-- Phase 4, slice 5, step 4 (#48): issue changes purge only `/metrics/issues`,
-- with their own throttle, so a burst of issue comments neither empties the
-- other metrics routes' edge cache nor spends the purge slot runs, pull
-- requests and releases share (`edge_purges`, whose single row is fixed by
-- its CHECK). Cloudflare allows a Worker 5 purges a minute and the shared slot
-- takes up to 4, so issues get one a minute (`ISSUE_PURGE_GAP`).
CREATE TABLE edge_purge_slots (
  slot TEXT PRIMARY KEY,                    -- what the purge is for: issues
  at   TEXT NOT NULL                        -- when it was last claimed
);

-- Seeded earlier than any clock can read (times compare as text), so the first
-- purge is always claimed.
INSERT INTO edge_purge_slots (slot, at) VALUES ('issues', '0000-01-01T00:00:00.000Z');
