# Issue response

The fifth slice of the public dashboard
([#48](https://github.com/bynk-lang/github-hooks/issues/48)): whether issues
are closed as fast as they're opened, how long they take to close, and what
is open and gone quiet. Later, once people outside the org file issues, it
also covers how long they wait for a maintainer to respond. This page covers
what is recorded and the daily sync that keeps it right. The routes and the
page at `/issues` follow in later steps.

## What the data says about the design

In the 30 days to 6 Nov, all 509 `bynk` issues were opened by the maintainer
account. None had a comment from a second human; the only other comments came
from `claude[bot]` and `dependabot[bot]`. So a maintainer's first response is
**recorded but not shown** until issues from outside the org arrive, as PR
flow does with reviews. The figures lead with flow instead: opened against
closed, time to close by label, the open backlog, and stale issues.

## What is recorded

The App already receives `issues` and `issue_comment` deliveries (phase 3's
welcome reads them), so nothing new needs subscribing. Migration `0013` adds
three tables, filled as deliveries arrive and kept indefinitely (retention
prunes `deliveries`, not these).

- **`issues`**: one row per issue, from any `issues` or `issue_comment`
  delivery (each carries the whole issue).
  - **Ordering:** a row only moves forward by `updated_at`; on a same-second
    tie the later arrival wins. So a late `labeled` never undoes `closed`, and
    a redelivery changes nothing.
  - **State:** GitHub's `state` and `state_reason` (`completed`,
    `not_planned`, `duplicate`, or `reopened` after a reopen, which also
    clears `closed_at`).
  - **Author:** the login, whether it's a bot (`user.type = 'Bot'`), and
    GitHub's `author_association`, which tells a maintainer (`OWNER`,
    `MEMBER`, `COLLABORATOR`) from everyone else.
  - **First response:** `first_response_at` and `first_responder` come from
    the first comment by a maintainer who isn't the issue's author and isn't
    a bot (a bot never counts, even one GitHub reports as a member). The
    response only moves earlier, so a comment delivered late still counts.
  - **Who is a maintainer:** an `OWNER`, `MEMBER` or `COLLABORATOR` by
    GitHub's author association, or a member of the organisation by GitHub's
    API.
    - **Why ask:** GitHub reports a member whose membership is **private** as
      a `CONTRIBUTOR` (or `NONE`), so for any other commenter the service asks
      `GET /orgs/{org}/members/{login}`, through the installation that sent
      the delivery. That needs the App's **Members: Read-only** permission
      ([setup](github-app.md)).
    - **Caching:** the answer is kept in `org_members` and reused for a day.
    - **Failures:** if GitHub can't say (a missing permission, an outage), the
      comment isn't counted, and a warning says why.
    - **Cost:** today every commenter is a public member or a bot, so the API
      isn't called at all. A deleted comment
    isn't a response, and deleting the first response doesn't clear it.
  - **Deleted and transferred issues:** these become tombstones (`state`
    `deleted` or `transferred`) with no labels. Nothing later changes them,
    so a late delivery can't bring one back. They're counted nowhere. A
    transferred issue reappears under its new repository from that
    repository's own deliveries.
- **`issue_labels`**: each issue's current labels.
  - **Ties:** adding several labels at once sends one `labeled` delivery per
    label, usually in the same second. Each carries the set at that moment,
    and they arrive in no guaranteed order.
  - **Whole set:** so the set is replaced only by a delivery strictly newer
    than the row.
  - **One label:** `labeled` and `unlabeled` then add or remove the one label
    they name, so same-second deliveries combine rather than overwrite one
    another, whatever order they arrive in.
  - **Stale deliveries:** a delivery the row has moved past never brings back
    an old set.

- **`org_members`**: GitHub's answers on organisation membership, by
  organisation and lower-case login, each reused for a day (see **Who is a
  maintainer** above).

**Comments on pull requests** also arrive as `issue_comment`, with
`issue.pull_request` set. They record nothing here; PR flow keeps its own
facts.

**Volume:** about 100 `issues` and 45 `issue_comment` deliveries a day across
the organisation. Each costs a few D1 writes: the row, plus one per label.

## History

There's no backfill: closed-issue figures start when this ships. The daily
sync below keeps the open backlog right from its first run.

## The daily sync

Deliveries alone miss two things: issues opened before the service saw them,
and a `closed` (or `deleted`, or `transferred`) delivery that never arrived,
which would leave an issue open for good. The `issueSync` cron service, daily
at 04:53 UTC, repairs both. It runs six minutes after the release sync.

1. **Listing:** for each public repository (not in `DASHBOARD_EXCLUDE`), it
   lists the open issues through the REST API, as the installation that last
   delivered for that repository. It reads up to 500, a page of 100 at a time,
   and saves them all in one D1 batch.
   - **Pull requests:** GitHub lists open pull requests here too (with
     `pull_request` set). They're left out.
   - **Ordering:** each saved issue follows the delivery rules above. A
     listing older than what deliveries recorded changes nothing, and its
     labels replace the set only when it's strictly newer.
2. **Repairs:** each issue the table still holds open that GitHub didn't list
   is read on its own and saved as it now is. The oldest go first, at most 50
   a repository per run.
   - **Transferred:** after a transfer, GitHub answers the old address with
     the issue where it now is. One answered from another repository becomes
     a `transferred` tombstone.
   - **Deleted:** one GitHub answers `404` or `410` for becomes a `deleted`
     tombstone.

It reads as the App, with the installation token the other syncs use, so it
needs only the **Issues: Read** permission the App already has. A refused call
is retried once with a fresh token.

**What it skips, with a warning rather than failing the run**, since each would
otherwise fail every day:

- a repository no installation has delivered for (and one whose deliveries
  have all aged out after the App was uninstalled);
- a repository GitHub answers `404` or `410` for;
- a renamed repository: GitHub redirects the old name, and the listed issues
  name the new one, which syncs under its own row.

Anything else (a refused token, a `5xx`, an issue that won't decode) fails the
run, naming each repository, after the others have synced. Each repository
logs one line:

```text
issue sync: bynk-lang/bynk has 22 open, 0 repaired
```

"Repaired" counts issues the run moved out of `open`. A repair that failed is
counted under "failed" instead.

**Its cost per run**, per repository: at most 5 list pages and 50 single reads
from GitHub (plus a token from KV), and a handful of D1 calls (the listing is
saved in one batch, and each repair in one more). With the pull request and
release syncs, that's far inside a Worker invocation's subrequest limit for
bynk-lang's few public repositories.
