# Releases

The third slice of the public dashboard
([#36](https://github.com/bynk-lang/github-hooks/issues/36)): how often each
repository releases, how long a merged pull request waits for a release to
ship it, and what is merged but not yet released. This page covers what is
recorded, how a release is matched to the pull requests it shipped, and the
daily sync. The public routes and the page at `/releases` follow in later
steps.

## Before it records anything

The App must be subscribed to **Release** events. They come under the
**Contents** permission, which the App already has, but the event itself has to
be ticked in the App's settings (**Permissions & events → Subscribe to
events**). Without it, no `release` delivery arrives and `releases` stays
empty.

## What is recorded

Migration `0009` adds one table and three columns, filled as deliveries arrive
and kept indefinitely (retention prunes `deliveries`, not these).

- **`releases`**: one row per release, keyed by repository and tag, from every
  `release` delivery (`created`, `published`, `edited`, `prereleased`,
  `released`, `deleted`). A `published` delivery records the release but
  doesn't match it; `released` does (below). A release deleted and published
  again for the same tag (a release re-run) is the same row. A `deleted` delivery keeps the row
  and sets `deleted_at` to when it arrived, so lead times don't shift; the
  pages won't show it. A draft has no `published_at` and is never shown. A
  **final** release is published and neither a draft nor a pre-release: only
  final releases ship pull requests.
- **On `pull_requests`**:
  - `merge_commit_sha`, the commit the PR's merge put on the base branch,
    recorded only once it has merged. GitHub also names a test merge commit
    for an open PR, which no release can ship. A source that doesn't name one
    (the sync's list read) keeps the last known value.
  - `released_in` and `released_at`: the first final release that shipped
    the PR, and when it was published.

## Matching a release to the pull requests it shipped

When a final release is published, the Worker matches it once, on the
`released` delivery. GitHub sends `released` alongside `published` when a
final release is published, and on its own when a pre-release is made final.
As the installation that delivered it, the Worker:

1. Looks for the **previous final release**: the other final release
   published latest before this one. It reads the repository's releases 30 a
   page, newest first, and stops when it finds one or reaches a short page
   (every release seen). It reads at most 3 pages (90 releases), since a run
   of pre-releases can push the previous final release off the first page.
2. Asks GitHub to compare the two tags (`previous...this`). That's 100 commits
   a page, up to 500; `bynk` ships about 30 between releases, about half of
   them version stamps.
3. Marks each merged pull request in that repository whose `merge_commit_sha`
   is one of those commits, or, for a PR recorded before its merge commit was,
   whose number a commit's first line names: `Title (#123)` for a squash
   merge (a revert of one ends with the revert's own number), or
   `Merge pull request #123 from …` for a merge commit. A PR already shipped
   by an earlier release keeps it.
4. Sets the release's `previous_tag`, and `shipped` to how many PRs it
   shipped, but only when the previous final release was published after the
   repository's pull requests began to be recorded (its first moment in
   `pull_request_events`; each repository starts when the App can see it).
   Before that, some of what the release shipped was never recorded, so a
   count would be short. Its PRs are still marked, for their lead times, and
   `shipped` stays null.

The match is by commit, not by time, so a release tagged on an older commit
ships only what it contains. What it can't match stays unknown rather than
wrong. `previous_tag` says how far it got: null until a release is tried, `''`
when it has no previous final release to compare with, else the previous tag.

| Case | What happens |
|---|---|
| A repository's first release | Nothing to compare against: `previous_tag` is `''` and `shipped` null, logged at `info` |
| No final release among the latest 90 | Not taken for a first release: `previous_tag` is `''` and `shipped` null, logged as a warning |
| A pre-release or a draft | Recorded; GitHub isn't asked anything |
| GitHub no longer has the comparison (`404`/`410`, a tag deleted from git) | `previous_tag` is recorded and `shipped` stays null, logged as a warning; it isn't tried again |
| GitHub refuses the list or the compare otherwise | Logged as an error; `previous_tag` and `shipped` stay null, so the sync tries again |
| A delivery with no installation | Logged as a warning; `shipped` stays null |
| More than 500 commits between tags | The first 500 are matched, with a warning |

A redelivery matches the same pull requests again and changes nothing.

## The daily sync

Deliveries alone miss releases published before the service saw them, and a
`released` or `deleted` delivery that never arrived. The `releaseSync` cron
service, daily at 04:47 UTC (six minutes after the pull request sync, so its
merges are in), repairs both. For each public repository not in
`DASHBOARD_EXCLUDE`, as the installation that last delivered for it, it:

1. Lists the repository's releases, 30 a page, up to 3 pages (90 releases),
   and records every one in one D1 batch. So release history (and cadence) is
   there from the first run, not just from the deploy.
2. When the listing was complete (its last page was short), marks deleted any
   release the table has that GitHub no longer lists. GitHub lists drafts only
   to those who can push, which the App can't, so drafts are left alone.
3. Matches each final release not yet tried (`previous_tag` null) that was
   published since the repository's pull requests began to be recorded, oldest
   first, at most 10 a run, against the previous final release in the
   listing, exactly as a `released` delivery would. One with no earlier final
   release in the listing (a repository's first, or one whose previous is past
   90) is recorded as tried (`''`), as is one whose comparison GitHub no longer
   has, so none of them holds a slot in later runs. Before any of the
   repository's pull requests is recorded, nothing is matched.
4. Logs one line per repository, such as
   `release sync: bynk-lang/bynk has 22 releases, 1 matched`.

As the pull request sync does, it skips with a warning a repository no
installation has delivered for, one GitHub no longer has (`404` or `410`), and
one GitHub now calls by another name (its releases sync under the new name's
own row). Any other refusal fails the run for that repository, after the others
have synced, and names it.
