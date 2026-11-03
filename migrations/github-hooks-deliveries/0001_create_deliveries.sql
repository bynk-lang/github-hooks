-- One row per GitHub delivery this service accepted. `id` is GitHub's
-- X-GitHub-Delivery GUID: a redelivery reuses it, so the primary key is what
-- makes receiving the same delivery twice harmless.
CREATE TABLE deliveries (
  id           TEXT PRIMARY KEY,
  event        TEXT NOT NULL,
  action       TEXT,
  repo         TEXT,
  sender       TEXT,
  org          TEXT,
  installation INTEGER,
  size         INTEGER NOT NULL,
  received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Activity by repository, newest first (the phase 2 read API).
CREATE INDEX deliveries_by_repo ON deliveries (repo, received_at);

-- Activity by event type, newest first.
CREATE INDEX deliveries_by_event ON deliveries (event, received_at);
