-- v0.2.0 (#62): every kind of live change purges only the routes it changes,
-- with its own throttle, as issues have since 0015. Before, runs, pull
-- requests and releases shared one slot (`edge_purges`) that purged every
-- metrics route, so a burst of CI runs spent the purges a merge needed.
--
-- Cloudflare allows a Worker 5 purges a minute. Runs, the busiest, may purge
-- `/metrics/ci` 3 a minute (every 20 seconds); pull requests and releases
-- share `flow` (`/metrics/prs` and `/metrics/releases`, as a merge changes
-- both pages), once a minute; issues keep theirs, once a minute.
-- `edge_purges` is no longer claimed, and is kept only so a Worker from before
-- this migration still runs while the new one deploys.
INSERT INTO edge_purge_slots (slot, at) VALUES
  ('runs', '0000-01-01T00:00:00.000Z'),
  ('flow', '0000-01-01T00:00:00.000Z');
