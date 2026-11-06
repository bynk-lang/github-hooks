# Issue response

The fifth slice of the public dashboard
([#48](https://github.com/bynk-lang/github-hooks/issues/48)): whether issues
are closed as fast as they're opened, how long they take to close, and what
is open and gone quiet. Later, once people outside the org file issues, it
also covers how long they wait for a maintainer to respond. This page covers
what is recorded. The daily sync, the routes and the page at `/issues`
follow in later steps.

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
two tables, filled as deliveries arrive and kept indefinitely (retention
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
    a bot (a bot never counts, even one GitHub reports as a member). A
    maintainer is an `OWNER`, `MEMBER` or `COLLABORATOR` by GitHub's
    association, or a login named in `MAINTAINERS` (see Settings). The
    response only moves earlier, so a comment delivered late still counts. A deleted comment
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

**Comments on pull requests** also arrive as `issue_comment`, with
`issue.pull_request` set. They record nothing here; PR flow keeps its own
facts.

**Volume:** about 100 `issues` and 45 `issue_comment` deliveries a day across
the organisation. Each costs a few D1 writes: the row, plus one per label.

## Settings

| Setting | Meaning |
|---|---|
| `MAINTAINERS` | optional. Comma-separated GitHub logins, matched without regard to case, who count as maintainers when they comment, in addition to GitHub's `OWNER`, `MEMBER` and `COLLABORATOR`. GitHub reports an organisation member whose membership is **private** as a `CONTRIBUTOR`, so their responses wouldn't count without it. A change applies to comments that arrive after it. |

## History

There's no backfill: closed-issue figures start when this ships. From step
2, a daily sync of open issues through the REST API keeps the backlog right
from the first day, and corrects any delivery that was missed.
