-- #68: when a change only the maintainers' live board hears last happened,
-- per purge slot (`purgeSlotOf`'s names). A change to a private or excluded
-- repository purges nothing at the edge (the public routes never showed it),
-- but the maintainers' shared figures (`sharedFigures`) are keyed on this as
-- well as on `edge_purge_slots`, so a signed-in page's refetch after it reads
-- afresh.
CREATE TABLE hidden_changes (
  slot TEXT PRIMARY KEY,
  at   TEXT NOT NULL
);

INSERT INTO hidden_changes (slot, at) VALUES
  ('runs',   '0000-01-01T00:00:00.000Z'),
  ('flow',   '0000-01-01T00:00:00.000Z'),
  ('issues', '0000-01-01T00:00:00.000Z');
