# Releases

The third slice of the public dashboard
([#36](https://github.com/bynk-lang/github-hooks/issues/36)): how often each
repository releases, how long a merged pull request waits for a release to
ship it, and what is merged but not yet released. This page covers what is
recorded, how a release is matched to the pull requests it shipped, the
daily sync, the public routes that read it, and the page at `/releases`.

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

## Routes

Both are public (no token), answer in plain JSON, and work like the CI and PR
routes:
- They're cached at Cloudflare's edge for 30 seconds, and purged when a live
  change arrives.
- They're limited to 60 uncached requests a minute per address.
- They read public repositories only, less `DASHBOARD_EXCLUDE`.

Drafts and deleted releases appear in neither.

### `GET /metrics/releases?days=7|30|90&repo=owner/name`

Each repository with a final release, over the window (7 days by default; any
other length is `400`). `repo` is optional and matched without case. Times
are nearest-rank percentiles, in seconds.

| Field | What it measures |
|---|---|
| `releases`, `prereleases` | final releases published in the window, and pre-releases, which count towards nothing else |
| `interval_p50_seconds` | the median time between each final release in the window and the final release before it (which may be before the window) |
| `last_tag`, `last_at` | the latest final release, whenever it was |
| `merge_to_release_p50_seconds`, `_p95_seconds` | **the headline:** `released_at − merged_at` over pull requests by people that a release in the window shipped; `shipped_counted` says how many |
| `waiting`, `waiting_since` | pull requests by people merged since the latest final release that no release has shipped yet, and when the oldest of them merged. One merged before it but never matched to a release (it may be in one that couldn't be matched) counts neither way. |
| `recording_since` | when the repository's pull requests began to be recorded: nothing merged before it can be measured |

`pipeline` lists each repository's release workflow over the window. A release
workflow is one that ran on a release's tag. Only its runs on tags are counted,
not those on branches, so a workflow triggered by every push isn't judged by
its feature-branch runs. A run names its ref without saying whether it's a
branch or a tag, so a tag is known by having a release, or by a `push` delivery
that pushed it (`refs/tags/…`, recorded in `tags`). So a tag whose release run
failed, and was never published, still counts. Each entry gives:
- `runs`;
- `failed` (failures and timeouts);
- `p50_seconds`, the median time from queued to completed of the successful
  runs.

### `GET /metrics/releases/recent?repo=owner/name`

Each repository's latest 20 published releases, newest first, with:
- `prerelease`;
- `previous_tag`, the final release it was compared with, or `null` until
  it's matched and for one with nothing before it;
- `shipped`, every PR it shipped, bots' included, `null` when unknown;
- `shipped_by_people`, how many of them were by people: the PRs
  `/metrics/releases` measures;
- a `url` to the release on GitHub.

### Queries

Migration `0010` adds `tags` (each tag pushed, from `push` deliveries) and
three indexes, chosen with `EXPLAIN QUERY PLAN`:
- `pull_requests_by_released`, on `released_at`, for merge to release over a
  window;
- `pull_requests_unreleased`, on `(repo, merged_at)` for merged pull requests
  no release has shipped, for what's waiting;
- `pull_requests_by_release`, on `(repo, released_in)`, for each recent
  release's count by people.

What's waiting is driven from each repository's latest release, so it searches
that index rather than scanning every unreleased pull request, which grows
with repositories that never release. The release workflows are found among
the window's runs through `workflow_runs_by_completed`, each run's ref looked up
in `tags` and `releases` by primary key. `releases` itself is read whole for the shown repositories.
That's at most 90 releases each, as the sync keeps them, and the interval
needs each repository's earlier releases anyway.

## The page

`/releases` is linked to and from the CI health page at `/` and the PR flow
page at `/prs`. It shares their stylesheet, the 7/30/90-day window choice and
the freshness line. For each repository with a release it shows:

- **Tiles:**
  - releases in the window, with the pre-releases and the median interval;
  - the time since the last release;
  - merge to release, with the 95th percentile, how many pull requests it
    counts, and when recording began if that's within the window;
  - what's waiting to ship, and how long the oldest has waited;
  - the release workflow's median time, with its runs and failures.
- **A chart:** pull requests by people that each recent final release
  shipped, oldest on the left. It's a single-series bar chart in the CI
  page's blue, with a hover target per release. A release whose count isn't
  known has no bar and says so on hover, and the chart isn't drawn when no
  count is known.
- **Recent releases:** the latest 10, each linked to GitHub, with when it was
  published, what it shipped (by people, with bots' added), and the release
  it followed. Pre-releases are marked. The rest of the 20 the route returns
  are folded under "earlier releases". On a narrow screen, rows become cards.

Everything from GitHub (repository names, tags, release names) is set as text,
never as markup. The page keeps which lists are open, and keyboard focus,
across redraws.

## Live feed

Releases share the live feed with runs and pull requests. A release delivery
is pushed as `kind: "release"`, with the repository, the delivery's action as
`status`, and the tag as `conclusion`:

```json
{"refetch_ms": 3000, "kind": "release", "repo": "bynk-lang/bynk", "number": 0, "path": "",
 "workflow": "", "run_id": 0, "attempt": 0, "status": "released", "conclusion": "v0.510.2"}
```

It's sent only in these cases:
- the delivery's first arrival, not a redelivery;
- a release that isn't a draft;
- a repository the public pages may show.

It's sent after any matching, so a refetch sees what the release shipped. The
releases page acts on `release` events and on a `pull` event whose pull
request merged, since that changes what's waiting to ship. The CI and PR pages
ignore `release` events. The refetch timing (`refetch_ms`, the purge and its
follow-up) is the PR page's ([pr-flow.md](pr-flow.md#live-feed)).
