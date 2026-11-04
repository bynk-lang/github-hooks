-- What the service did in response to each delivery, one row per action per
-- delivery. The key makes an action happen at most once: it is claimed with
-- status 'started', and a claim on an existing row succeeds only when that row
-- 'failed', so a redelivery retries a failed action and repeats nothing else.
CREATE TABLE actions (
  delivery TEXT NOT NULL,
  action   TEXT NOT NULL,
  status   TEXT NOT NULL CHECK (status IN ('started', 'done', 'failed')),
  detail   TEXT,
  at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (delivery, action)
);

-- Who has been welcomed where: at most once per person per repository, since
-- GitHub reports FIRST_TIME_CONTRIBUTOR on each of someone's pull requests until
-- one is merged. Names are stored lower-cased (GitHub's are case-insensitive).
-- A welcome claims its row before commenting and releases it if the comment
-- fails; `delivery` names the claim's owner, so a redelivery can re-claim it.
CREATE TABLE welcomed (
  repo     TEXT NOT NULL,
  login    TEXT NOT NULL,
  delivery TEXT NOT NULL,
  at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (repo, login)
);
