# Releases

The third slice of the public dashboard
([#36](https://github.com/bynk-lang/github-hooks/issues/36)): how often each
repository releases, how long a merged pull request waits for a release to
ship it, and what is merged but not yet released. This page covers what is
recorded and how a release is matched to the pull requests it shipped. The
daily sync, the public routes and the page at `/releases` follow in later
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
  `released`, `deleted`). A release deleted and published again for the same
  tag (a release re-run) is the same row. A `deleted` delivery keeps the row
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

When a final release is published (a `published` delivery, or `released` for
a pre-release made final), the Worker, as the installation that delivered it:

1. Lists the repository's latest 30 releases and takes the **previous final
   release**: the other final release published latest before this one.
2. Asks GitHub to compare the two tags (`previous...this`). That's 100 commits
   a page, up to 500; `bynk` ships about 30 between releases, about half of
   them version stamps.
3. Marks each merged pull request in that repository whose `merge_commit_sha`
   is one of those commits, or, for a PR recorded before its merge commit was,
   whose number a commit's first line names: `Title (#123)` for a squash
   merge (a revert of one ends with the revert's own number), or
   `Merge pull request #123 from …` for a merge commit. A PR already shipped
   by an earlier release keeps it.
4. Sets the release's `previous_tag`, and `shipped` to how many PRs it shipped.

The match is by commit, not by time, so a release tagged on an older commit
ships only what it contains. What it can't match stays unknown rather than
wrong:

| Case | What happens |
|---|---|
| A repository's first release | Nothing to compare against: `previous_tag` and `shipped` stay null, logged at `info` |
| A pre-release or a draft | Recorded; GitHub isn't asked anything |
| GitHub refuses the list or the compare | Logged as an error; `shipped` stays null |
| A delivery with no installation | Logged as a warning; `shipped` stays null |
| More than 500 commits between tags | The first 500 are matched, with a warning |

A redelivery matches the same pull requests again and changes nothing.
