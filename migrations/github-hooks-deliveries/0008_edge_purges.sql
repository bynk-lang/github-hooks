-- The public metrics routes are cached at Cloudflare's edge (EdgeCache), and
-- each live change purges them. Cloudflare allows a Worker 5 purges a minute
-- (a bucket of 25), so a purge first claims this row: a conditional update
-- that succeeds at most once per 15 seconds, across every Worker isolate.
CREATE TABLE edge_purges (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  at TEXT    NOT NULL                       -- when the last purge was claimed
);

-- Seeded earlier than any clock can read (times compare as text), so the first
-- purge is always claimed.
INSERT INTO edge_purges (id, at) VALUES (1, '0000-01-01T00:00:00.000Z');
