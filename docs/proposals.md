# The App's proposals (phase 5)

In phase 5 (#69) the App does more than record and welcome: it works out
things worth doing, such as labels for a new issue, and **proposes** them.
A maintainer approves or declines each one in Mine on the dashboard, and
nothing reaches GitHub until a maintainer approves.

This page is the overview: how the pieces fit, what is sent to Anthropic and
when, what is kept, and how to turn it on and off. The details are in:

| Page | Covers |
|---|---|
| [settings.md](settings.md) | `.github/bynk-hooks.yml`: its keys, how it's read and cached, and its problems in Mine |
| [maintainers.md](maintainers.md#the-apps-proposals) | approving and declining: the routes, refusals, expiry and the audit |
| [deploy.md](deploy.md) | `ANTHROPIC_API_KEY` and the daily caps, as Worker settings |

The foundations (#88) are in place, and four features propose:
[issue triage](#issue-triage),
[stale pull request nudges](#stale-pull-request-nudges),
[release notes drafts](#release-notes-drafts) and
[the weekly summary](#the-weekly-summary). Each feature
arrived as its own slice of #69, and has its own section here:

| Feature | Slice | Claude | Proposes |
|---|---|---|---|
| [Issue triage](#issue-triage) (#95) | 2, built | Haiku 5.5 | labels for a new issue, from the repository's allowed list |
| [Stale pull request nudges](#stale-pull-request-nudges) (#103) | 3, built | none | a comment to a ready pull request's reviewers |
| [Release notes drafts](#release-notes-drafts) (#110) | 4, built | Opus 5.5 | notes for a release, from the pull requests it shipped |
| [The weekly summary](#the-weekly-summary) (#119) | 5, built | Opus 5.5 | the organisation's week, posted to a Discussion |

## How it fits together

```text
delivery ──▶ feature ──▶ settings on? ──▶ claim a Claude call ──▶ Claude ──▶ proposal ──▶ Mine
            (e.g. a new   (bynk-hooks.yml)  (the daily caps)        (one      (pending)    Approve ─▶ GitHub
             issue)                                                  request)              Decline
```

1. **A delivery** (or a schedule) gives a feature something to work on.
2. **The repository's settings** say whether the feature is on there
   ([settings.md](settings.md)). Every feature is off unless the repository's
   `.github/bynk-hooks.yml` turns it on. A missing, empty, refused or
   unreadable file leaves everything off.
3. **A Claude call is claimed** against two daily caps, per repository and
   in total, before it is made ([below](#the-daily-caps)). Past either cap,
   the feature waits for the next UTC day.
4. **Claude is asked once**, with a JSON schema for its reply, so the answer
   is data, not prose (`askClaude`, in `src/github/hooks/claude.bynk`).
5. **A proposal is recorded** (`proposals`, migration `0024`), with Claude's
   short reason, and every open maintainer's page hears of it.
6. **A maintainer decides** in Mine, under **Proposed by the App**.
   Approving acts on GitHub as the App, at once. Declining asks nothing of
   GitHub. Either way the decision is audited.

A proposal that nobody decides expires after 14 days.

## What is sent to Anthropic, and when

The App calls Claude only for a repository whose `.github/bynk-hooks.yml`
turns a Claude feature on. That applies to private repositories too: each
repository's maintainers decide for it, by pull request. Without the file,
nothing of that repository's is sent.

What happens to it there is Anthropic's to say: API inputs and outputs are
covered by Anthropic's [Commercial Terms](https://www.anthropic.com/legal/commercial-terms)
and its policies on API data, which are worth reading before opting in a
private repository.

`askClaude` doesn't read the settings itself. Each feature reads its
repository's settings (`settingsFor`) before it asks, and its tests show
that a repository with the feature off sends nothing.

When a feature is on, one Messages API request carries:

- **The feature's instructions**, written in code, as the system prompt.
  Each feature's section says what else they include: for triage, the
  repository's allowed labels with their descriptions.
- **The material to work on**, as the user turn: for triage, the issue's
  title and body; for release notes, the shipped pull requests' titles,
  authors and labels; for the weekly summary, the week's figures and the
  titles of what was merged and released. This is anyone's text, and may try to give instructions.
  It goes in the user turn as a quoted string, never the system prompt. The
  instructions say it is data to classify, not instructions to follow.
- **The schema the reply must match.** For triage, the label field is a list
  chosen from the allowed labels, so Claude can't invent one.

Nothing else is sent: no GitHub tokens or other secrets, and no other
repository's data. The request goes straight from the Worker to
`api.anthropic.com`, authenticated with the key in `ANTHROPIC_API_KEY` (a
Worker secret), with `anthropic-version: 2026-10-21`.

**Prompt injection.** Text written to steer Claude can steer everything
Claude writes, including a proposal's **reason**, which is shown to the
maintainer deciding. So the reason is untrusted too: judge a proposal by its
target and what it would do, not only by its reason.

- **For triage**, the reach is small. The schema limits the action to
  labels from the repository's allowed list, so the worst is a wrong label
  with a persuasive reason, which a maintainer declines.
- **For the features that propose text to post** (release notes, the weekly
  summary), a steered reply *is* the action. Each states its own reach, and
  what a maintainer should check, in its section here. For release notes,
  Claude only sorts the pull requests and writes a plain-text summary: the
  App writes every line, and escapes the summary
  ([below](#release-notes-drafts)). For the weekly summary, Claude writes
  only plain-text paragraphs, and the App writes the figures and the releases
  ([below](#the-weekly-summary)).

**Refusals.** Claude may decline a request. A refusal makes no proposal and
is logged with its category. On Opus 5.5 the API's server-side fallback is
on, so a refused request may be answered by a fallback model. The call
records that, and which model answered. Haiku 5.5 has no fallback.

## The daily caps

| Setting | Default | Meaning |
|---|---|---|
| `CLAUDE_DAILY_CAP_REPO` | 50 | Claude calls one repository may make in a UTC day. `0` stops every call |
| `CLAUDE_DAILY_CAP_TOTAL` | 200 | Claude calls across every repository in a UTC day |

- **Claimed first.** Each call is claimed in D1 (`claude_calls_daily`) before
  it is made, in one statement that checks both caps. Two calls at once can't
  both take the last one.
- **Answered, not billed.** A call that gets no answer (Anthropic
  unreachable, or an error status) gives its claim back. So the caps count
  calls answered. A request that reached Anthropic before its connection
  dropped can still be billed, so give the key a **spend limit in the
  Anthropic Console** as the backstop.
- **In Mine.** Once Claude is in use, every signed-in page shows a line
  with today's calls against both caps.
- **Shared with anyone who can open issues.** A feature that runs on what
  people open, as triage does, spends the cap on their behalf. Triage limits
  one author to 3 triaged issues a day in a repository
  ([below](#issue-triage)), but many accounts can still spend a
  repository's 50, and with it part of the day's 200. Set the caps with that
  in mind for a public repository. Past a cap nothing reaches GitHub: the
  feature only goes without, and an issue opened then stays untriaged.

## Issue triage

Slice 2 of #69, built in #95. When an issue is opened in a repository that
turns triage on, Claude Haiku 5.5 suggests labels for it from the
repository's allowed list, and the suggestion becomes a `labels` proposal
in Mine. Approving it adds the labels.

**Turning it on**, in the repository's `.github/bynk-hooks.yml`
([settings.md](settings.md)):

```yaml
triage:
  enabled: true
  labels: [bug, enhancement, documentation]   # the only labels it may suggest
```

`labels` are matched against the repository's own labels without regard to
case, and only those the repository has are offered, in its spelling. A
label listed here that the repository doesn't have is left out, rather than
proposed and created by GitHub on approval. An empty list, or one the
repository has none of, means triage does nothing.

**When it runs.** On `issues.opened` only, after the delivery is answered.
An issue is left alone, with no call to Claude, and none to GitHub beyond
reading the settings file:

- when it's a pull request, was opened by a bot, or was opened with labels
  already (a template or a maintainer triaged it);
- when the repository's settings don't turn triage on;
- when its author has had 3 issues triaged by Claude in that repository in
  the last day, so one person, or one script, can't spend the cap
  (`AUTHOR_DAILY_TRIAGES`). Only runs that spent a call count: those that
  ended `done` with Claude's answer. A capped or failed run doesn't use the
  author's share;
- when it has had a `labels` proposal before, whatever became of it. **A
  decline is final for its issue.**

Each delivery is claimed once (`actions`, as `triage`), so a redelivery
doesn't ask again.

**What is sent.** One request: Haiku 5.5, thinking off, low effort,
`max_tokens` 300.

- **System:** the instructions, then each allowed label with its
  description. It's marked for caching like every system prompt, but it is
  well short of Haiku's 512-token minimum, so it isn't cached: no cache
  reads for triage in `claude_calls` is expected.
- **User:** the issue as a JSON object, `{"title", "body",
  "body_truncated"}`, with the body cut at 6,000 characters.
- **Schema:** `labels`, each one of the allowed labels, and a one-sentence
  `reason`.

**What is proposed.** Claude's labels are kept only where they're allowed
(whatever the schema promised), in the repository's spelling, once each,
three at most. None left means no proposal. Otherwise the proposal carries
the issue's title, the labels and Claude's reason, and links its call.

**Its reach under prompt injection.** An issue written to steer Claude can
pick which of the allowed labels are proposed, and write a persuasive
reason. It can't propose a label outside the list, more than three, or
anything but labels. So check a proposal against the issue itself, not
only against its reason.

**When it ends without a proposal.** Every run's end is recorded in
`actions` (`detail`) and logged:

| Ended | Status | Meaning |
|---|---|---|
| proposed `…` | `done` | a proposal is waiting in Mine |
| Claude suggested no label | `done` | nothing fitted clearly |
| Claude declined to triage it | `done` | a refusal, logged with its category |
| Claude's reply was cut off | `done` | it ran out of its 300 tokens |
| Claude's answer did not decode: … | `done` | the reply didn't match the schema |
| none of triage.labels is a label the repository has | `done` | check the settings file against the repository's labels |
| it already has a labels proposal | `done` | a decline is final |
| … has had 3 issues triaged here in the last day | `done` | the author's share is used |
| the … daily cap on Claude calls is reached | `failed` | see below |
| Claude could not be asked: … | `failed` | Anthropic unreachable, or an error status |
| ANTHROPIC_API_KEY is not set | `failed` | no key on the Worker |
| GitHub refused …'s labels: … | `failed` | the labels couldn't be read |
| could not read …'s labels: …, or …'s labels did not decode: … | `failed` | GitHub unreachable, or an answer that isn't a list of labels |
| could not … | `failed` | a D1 error: counting, looking up or proposing |

A `failed` run isn't retried by itself: an issue opened while a cap is
reached stays untriaged. Redelivering its delivery (the App's settings,
*Advanced*, *Redeliver*) once the cap has reset, or the key is set, runs it
again.

**Its cost.** A call is the instructions and labels (a few hundred tokens)
plus the issue: a short one adds little, and the longest, cut at 6,000
characters, adds about 1,500 for English prose, and more for code, logs or
Chinese and Japanese text. At most 300 tokens come back. It runs on
Haiku 5.5, and `claude_calls` records each call's tokens, so the real cost
is in D1.

## Stale pull request nudges

Slice 3 of #69, built in #103. Each weekday morning the App looks for ready
pull requests that have waited on review longer than their repository allows,
and proposes a comment to the people still asked to review each one. Approving
it posts the comment as the App. There's **no Claude call**: the wording is
fixed, so nothing is sent to Anthropic.

**Turning it on**, in the repository's `.github/bynk-hooks.yml`
([settings.md](settings.md)):

```yaml
nudges:
  enabled: true
  after_days: 3      # 1 to 30; 3 if left out
```

**When it runs.** At 07:43 UTC, Monday to Friday: 07:43 GMT or 08:43 BST, at
the start of the UK working day, and never at the weekend. The same run then
proposes [the weekly summary](#the-weekly-summary); a failure of either
doesn't stop the other.

**What counts as waiting.** A pull request is waiting when it is open, not a
draft, not opened by a bot, not locked, and someone (a person or a team) is
still asked to review it. Its wait starts at the latest of:

- when it last became ready for review;
- its earliest outstanding review request, so no one is told they've waited
  longer than they were asked;
- its last review by someone other than its author, and not a bot. The
  author's own replies, or an automated reviewer's, don't restart it.

It's nudged once the wait reaches `after_days` whole 24-hour periods,
counted to the scheduled time, weekends included. So a wait that started
on Monday at 17:00 is one whole day old at Wednesday's 07:43 run, and two
at Thursday's.

**What is proposed.** A `comment`, for example:

> @alice @bob, this pull request has been waiting on your review for 4 days
> (team: core).

Each person still requested is @-mentioned. Teams are named without the @,
so a whole team isn't notified; with only teams requested, the comment
mentions no one. Mine shows the comment in full, so you approve exactly what
will be posted.

**Once per wait.** A pull request gets at most one nudge per wait, whatever
became of it: **a decline holds until the wait starts again**, after a review
or a new round of ready for review. A pending nudge from an earlier wait
stands rather than a second one.

**A nudge whose reason has gone isn't posted.**

- Each run first **expires** a pending nudge whose pull request is no longer
  waiting (merged, closed, reviewed, back to draft, locked, or no one
  requested), or is waiting since a different time.
- Approving a nudge checks it again, against the same test the job uses,
  as the App last recorded the pull request. If it's no longer waiting
  (merged, closed, back to draft, locked, or no one requested), or its wait
  has started again since (a review, or a new round of ready for review),
  the approval is refused with a `409` and the nudge expires. Nothing is
  posted. That covers the hours between runs, and the weekend.

**Its log.** Each run logs one line, such as "nudges: 9 waiting on review;
proposed 2, already nudged this wait 3, not yet due 2, nudges off 2, expired
1 no longer waiting". A proposal it can't record fails the run, naming the
pull request, after the others have been tried.

## Release notes drafts

Slice 4 of #69, built in #110. When a final release is published in a
repository that turns release notes on, and its description is empty or only
GitHub's generated list, Claude Opus 5.5 groups the pull requests it shipped
and writes a short summary. The App writes the notes from that and from what
it has recorded, and proposes them as a `release_notes` proposal in Mine.
Approving it fills the release's description.

**Turning it on**, in the repository's `.github/bynk-hooks.yml`
([settings.md](settings.md)):

```yaml
release_notes:
  enabled: true
```

It also needs the App's **Contents: Read and write** permission, to write a
release's description. That permission reaches much further, to code,
branches and tags, so read what it allows in
[github-app.md](github-app.md#4-permissions-and-events) first.
Without it, notes are still proposed, but approving them fails with GitHub's
`403`, and Mine names the permission.

**When it runs.** On the `released` delivery GitHub sends as a final release
is published, or as a pre-release is made final, once the App has matched
the pull requests it shipped ([releases.md](releases.md)). A release is left
alone, with no call to Claude:

- when it's a pre-release or a draft, or the delivery is only `published`;
- when it couldn't be matched: a repository's first release, or one GitHub
  can no longer compare with the release before it. Its settings aren't
  even read;
- when the repository's settings don't turn release notes on;
- when its description is **written**: anything other than empty, or only
  the lines of GitHub's generated list (its `## What's Changed` and
  `## New Contributors` headings, its `* … in https://…` entries, and one
  `**Full Changelog**: …` line, last). A paragraph of someone's own,
  anywhere, makes it written;
- when it has had a `release_notes` proposal before, whatever became of it.
  **A decline is final for its release;**
- when it shipped no pull request the App recorded.

Each delivery is claimed once (`actions`, as `release_notes`), so a
redelivery doesn't ask again.

**What is sent.** One request: Opus 5.5, medium effort, `max_tokens` 16,000.
Opus always thinks, and its thinking counts against that budget, so it's
roomy; only what's produced is billed.

- **System:** the instructions and the fixed headings (Features, Fixes,
  Documentation, Other).
- **User:** the release's tag and name, and each pull request it shipped, in
  the order they were merged, as a JSON object: its number, title, author and
  labels. Bodies, diffs and comments aren't sent. At most 200 pull requests
  are sent; `more_not_shown` says how many more there were.
- **Schema:** a `summary`, and `groups`, each a heading from the fixed set
  with the numbers of the pull requests under it.

**What is proposed.** Claude only sorts, and writes the summary. The App
writes the notes:

```markdown
Builds are faster, and a crash on Windows is fixed.

## Features

- Faster builds (#30) by @accuser

## Fixes

- Fix a crash on Windows (#31) by @alice

**Full Changelog**: https://github.com/bynk-lang/bynk/compare/v0.4.0...v0.5.0
```

- The summary comes first, cut at 800 characters. Each heading follows in
  the fixed order, and a heading with nothing under it is left out.
- Each line is the App's own, from the pull request as recorded: its title,
  its number and its author. A number Claude names that the release didn't
  ship is dropped. A pull request is listed once, under the first heading
  that names it. One Claude didn't place, or wasn't shown, goes under
  **Other**, so every shipped pull request is listed.
- **Titles and the summary are plain text, by construction.** Each is put on
  one line, with Markdown's punctuation backslash-escaped, and a leading
  list, quote or heading marker escaped too. An `@` in them is followed by a
  zero-width space. So neither can add a heading, list, link, image, HTML,
  table, `#n` or `org/repo#n` reference, or mention anyone. The only
  mentions are the App's own `by @<author>`. A bare URL is still linked by
  GitHub, but shows as itself. A title with code in backticks shows its
  backticks.
- Over GitHub's generated list, its **Full Changelog** line is kept below
  the notes.
- Mine shows the notes in full, as text, linked to the release. Over a
  generated list, it also shows the description approving replaces, under
  *Replaces the current description*.

**Approving it** re-reads the release from GitHub first. The notes are
written only if its description is still empty, or still exactly the one
seen when they were proposed. Otherwise the approval is refused with a
`409`, the proposal expires, and nothing is written. A release that's been
deleted is refused the same way. If GitHub can't be asked, the proposal is
given back, still pending, with a `503`. See
[maintainers.md](maintainers.md#the-apps-proposals).

**Its reach under prompt injection.** A title written to steer Claude can
choose which heading each pull request goes under, and what the summary
says, in plain text. It can't add a line, a link, a mention or a pull
request, drop one, or change a title or an author. So read the summary as
you would anyone's text before approving: it is the part a steered reply
reaches, and it is published on the release page as written.

**When it ends without a proposal.** Every run's end is recorded in
`actions` (`detail`) and logged:

| Ended | Status | Meaning |
|---|---|---|
| proposed notes for … pull requests (proposal …) | `done` | a proposal is waiting in Mine |
| it already has a release notes proposal | `done` | a decline is final |
| it shipped no recorded pull request | `done` | nothing to write about |
| Claude declined to write the notes | `done` | a refusal, logged with its category |
| Claude's reply was cut off | `done` | it ran out of its 16,000 tokens |
| Claude's answer did not decode: … | `done` | the reply didn't match the schema |
| the … daily cap on Claude calls is reached | `failed` | see [the daily caps](#the-daily-caps) |
| Claude could not be asked: … | `failed` | Anthropic unreachable, or an error status |
| ANTHROPIC_API_KEY is not set | `failed` | no key on the Worker |
| could not … | `failed` | a D1 error: looking up, reading or proposing |

A release passed over before the claim records nothing. One whose
description is written, or whose delivery names no installation, logs why;
one that isn't a final release, wasn't matched, or is in a repository with
release notes off is passed over without a word. A `failed` run isn't retried by itself:
redelivering the release's `released` delivery once the cause has passed runs
it again.

**Its cost.** One call per release. It's the instructions (a few hundred
tokens) plus about 20 to 40 tokens a pull request, so roughly 4,000 to
8,000 for 200. The answer is a few tokens a pull request plus the summary, and
Opus's thinking on top. `claude_calls` records each call's tokens, so the
real cost is in D1.

## The weekly summary

Slice 5 of #69, built in #119. Each weekday morning, for the week before the
latest Monday, Claude Opus 5.5 writes a few paragraphs about the
organisation's week from the public dashboard's figures. The App writes the
post around them: the title, a table of figures, and the releases. It
proposes the post as a `discussion` proposal in Mine, and approving it posts
the post to the repository's Discussions.

**Turning it on**, in the `.github/bynk-hooks.yml` of the repository whose
Discussions should carry it ([settings.md](settings.md)):

```yaml
weekly_summary:
  enabled: true
  category: Announcements   # the Discussions category to post in; the default
```

- **Turn it on in one repository per organisation,** such as `.github`. The
  summary is about the whole organisation, whichever repository it's set in.
  Every repository that turns it on gets the same summary, as its own
  proposal, and costs its own Opus call each week.
- The repository needs **Discussions turned on**, with a category of that
  name. The name is matched without regard to case.
- The App needs **Discussions: Read and write**
  ([github-app.md](github-app.md#4-permissions-and-events)). It doesn't need
  the `discussion` event. Without the permission, summaries are still
  proposed, but approving one fails with GitHub's `403`, and Mine names the
  permission.
- **Announcement-format categories are unconfirmed.** GitHub limits who may
  start a discussion in an announcement-format category, such as the
  default `Announcements`, and whether that admits the App is yet to be seen
  on a first post. If approving is refused, Mine shows GitHub's reason, and
  an open-format category, such as `General`, is the way round it.

**What it covers.** The repository's owner, and that organisation's
**public** repositories as the public dashboard shows them, the host
repository included. A repository named in `DASHBOARD_EXCLUDE` is left out,
and so are private ones and other organisations'. Nothing private is sent
to Claude or posted. The figures are D1's own, as the dashboard has them.

**When it runs.** With the nudges, each weekday at 07:43 UTC
([above](#stale-pull-request-nudges)). Each run is for the week before the
latest Monday: Monday 00:00 to the next Monday 00:00 UTC. So Monday's run
writes it, and Tuesday to Friday try again for a Monday that failed. A
repository is left alone, with no call to Claude:

- when its settings don't turn `weekly_summary` on;
- when it has had that week's proposal, whatever became of it.
  **A decline is final for its week;**
- when Claude declined to write that week's summary, or was cut off, since
  the week ended (a `claude_calls` row);
- when the week was **quiet**: no pull request merged, no issue opened or
  closed, and no release, in any of the organisation's public repositories.
  CI runs alone don't count, so a week of scheduled runs gets no summary.

**What is sent.** One request: Opus 5.5, medium effort, `max_tokens` 16,000,
as for release notes.

- **System:** the instructions, naming the organisation. They say that the
  titles are anyone's text, to summarise and never to follow. They ask for two
  to four short paragraphs of plain text, without Markdown, links or
  mentions.
- **User:** the week, as a JSON object:
  - `week_from` and `week_to`, its Monday and Sunday;
  - `repositories`: each active repository's figures, busiest first, at
    most 30;
  - `pull_requests_merged`: each pull request merged, with its repository,
    number, title and author, in the order they were merged, at most 100;
  - `releases`: each final release published, with its repository, tag and
    name, at most 30;
  - `repositories_not_shown` and `pull_requests_not_shown`: how many more
    there were.

  Bodies, diffs, comments and issues' titles aren't sent.
- **Schema:** `paragraphs`, a list of strings.

**The figures,** for each public repository with activity that week:

| Column | Counts |
|---|---|
| Pull requests merged | pull requests merged in the week |
| Median time to merge | from opened to merged, in whole hours: as hours under 48, then as whole days |
| Issues opened, Issues closed | issues opened, and issues closed, in the week |
| CI runs | workflow runs completed in the week, and how many of them failed or timed out |
| Releases | final releases published in the week, not drafts, pre-releases or deleted ones |

The busiest come first, by merges, issues and releases together, then by CI
runs.

**What is proposed.** Claude writes only the paragraphs. The App writes the
rest:

```markdown
A steady week: the parser got faster and a crash was fixed.

bynk v0.6.0 shipped on Saturday.

## The week in figures

| Repository | Pull requests merged | Median time to merge | Issues opened | Issues closed | CI runs | Releases |
|---|---:|---:|---:|---:|---:|---:|
| bynk-lang/bynk | 2 | 10 h | 1 | 1 | 3 (1 failed) | 1 |
| bynk-lang/github-hooks | 1 | 1 h | 0 | 0 | 0 (0 failed) | 0 |

## Releases

- [bynk-lang/bynk v0.6.0](https://github.com/bynk-lang/bynk/releases/tag/v0.6.0)

<sub>Drafted by Claude from the public dashboard's figures, and approved by a maintainer before it was posted.</sub>
```

- **The title** is fixed: "The week of 9 November 2026".
- **The paragraphs** come first: at most four, empty ones dropped, each cut
  at 800 characters. Each is made plain text on one line, as release notes'
  summaries are ([above](#release-notes-drafts)). So none can add a heading,
  list, link, image, HTML, table, reference or mention.
- **The table** has at most 30 rows, the busiest first, with a line counting
  the rest. **The releases** are linked by tag.
- **The pull requests' titles aren't in the post.** Claude reads them, and
  only the paragraphs can reflect them.
- Mine shows the title, the category and the post in full, as text, linked
  to the repository's Discussions.

**Approving it** asks GitHub's GraphQL API for the repository and its
Discussions categories, as the installation. It finds the category by name,
then creates the discussion (`createDiscussion`).

- **A later week's summary has been proposed:** the approval is refused with
  a `409`, the proposal expires, and nothing is posted. An old week's
  summary isn't posted as if it were current.
- **Nowhere to post** (Discussions turned off, no category of that name, or
  a GraphQL error): the proposal fails with GitHub's reason and a `502`. For
  a missing category, the reason lists the categories the repository has.
  A `403`, or GraphQL's `FORBIDDEN`, names the permission.
- **GitHub can't be asked:** the proposal is given back, still pending, with
  a `503`.

See [maintainers.md](maintainers.md#the-apps-proposals).

**Its reach under prompt injection.** A pull request's title written to
steer Claude can change what the paragraphs say, in plain text. It can't
change the title, the figures, the releases or the footer, add a link or a
mention, or put itself in the post. So read the paragraphs as you would
anyone's text before approving: they are the part a steered reply reaches,
and they are posted as written, under the App's name.

**How a run ends.** Each run logs one line, for example:

```text
weekly summary for 9 November 2026: proposed 1, already proposed 0, quiet 0, off 3, not written 0
```

| Outcome | Logged | Tried again |
|---|---|---|
| proposed | `weekly summary for <repo>: proposed (proposal …)` | no: once per week |
| Claude declined to write the summary | a warning | no, for that week |
| Claude's reply was cut off | a warning | no, for that week |
| Claude's answer did not decode | a warning | on the next weekday's run |
| a daily cap reached, Anthropic unreachable, `ANTHROPIC_API_KEY` not set, or a D1 error | an error: the run fails, naming the repository and why | on the next weekday's run |

The last chance for a week is Friday's run. After that the week is left
behind.

**Its cost.** One call per host repository per week, counted in that
repository's daily cap, and again on a later weekday only for a call that
failed or didn't decode. A call is the instructions (a few hundred tokens),
plus roughly 60 tokens a repository and 30 a pull request. So it's up to
about 5,000 for 30 repositories and 100 pull requests. The answer is a few
hundred tokens, with Opus's thinking on top. `claude_calls` records each
call's tokens, so the real cost is in D1.

## What is kept

| What | Where | For |
|---|---|---|
| Each call: when, which repository and feature, the model asked and the model that answered, how it stopped, the token counts, the outcome, and the proposal it made | `claude_calls` | 90 days |
| Calls per repository per UTC day | `claude_calls_daily` | 7 days |
| Each proposal: its target and title, what it would do (for release notes, the notes and the description they'd replace; for the weekly summary, the post and its category), its reason (Claude's, for triage), and how it was decided | `proposals` | pending for up to 14 days; 90 days after a decision |
| Each decision: who, which proposal, GitHub's status and what happened | `maintainer_actions` | kept |
| What each repository's settings file said when last read | `repo_settings` | kept, one row per repository; Mine shows the last 7 days |

The App does **not** keep the text it sends to Claude (an issue's body,
say), nor Claude's reply beyond what the proposal holds (for release notes,
the notes it wrote from it; for the weekly summary, the post). What Anthropic
keeps of a request is set by its API terms
([above](#what-is-sent-to-anthropic-and-when)). The logs name the feature,
the repository and the outcome, never the material. The hourly `retention`
cron does the pruning.

## Turning it on

1. **The key.** Add `ANTHROPIC_API_KEY` to the `production` environment's
   secrets, as [deploy.md](deploy.md) describes, and set a spend limit on
   the key in the Anthropic Console. Without the key, a feature that asks
   Claude logs a warning and proposes nothing. Nothing is claimed or sent.
2. **The caps** (optional). Set `CLAUDE_DAILY_CAP_REPO` and
   `CLAUDE_DAILY_CAP_TOTAL` if the defaults don't suit. Changing one that's
   already on the Worker takes a deploy with *overwrite secrets*.
3. **The App's permissions.** The App needs **Contents: Read-only** for the
   settings file, **Issues: Read and write** to apply labels, and **Pull
   requests: Read and write** to comment on a pull request. Release notes
   raise Contents to **Read and write**, to write a release's description.
   That permission also lets the App push code, branches and tags on every
   repository it's installed on, though its code only writes release
   descriptions, so read
   [github-app.md](github-app.md#4-permissions-and-events) before an
   organisation owner grants it. The weekly summary needs **Discussions:
   Read and write**, to post a discussion.
4. **Each repository opts in** with `.github/bynk-hooks.yml` on its default
   branch ([settings.md](settings.md)). Its maintainers merge that like any
   other change.

## Turning it off

- **One feature in one repository:** set its `enabled: false`, or remove
  its section, by pull request. The push that merges it is read at once.
- **Everything in one repository:** delete `.github/bynk-hooks.yml`.
- **Every Claude call, everywhere, at once:** delete the key from the
  Worker, with `wrangler secret delete ANTHROPIC_API_KEY` or in the Worker's
  *Settings → Variables and Secrets* in the Cloudflare dashboard. It needs no
  deploy: from the next call, `askClaude` claims, sends and records nothing.
  Revoking the key in the Anthropic Console stops calls as fast, and they're
  recorded as `failed`. Delete the `ANTHROPIC_API_KEY` Actions secret too, or
  the next deploy with *overwrite secrets* puts the key back.
- **Every Claude call, everywhere, kept recorded:** set the
  `CLAUDE_DAILY_CAP_REPO` Actions secret to `0`, then run the deploy workflow
  with *overwrite secrets*
  ([deploy.md](deploy.md), "How the deploy uses them"). A routine deploy only
  sets a secret the Worker doesn't have yet, so it won't change a cap
  that's already set. Each call is then recorded as `capped`, and nothing is
  sent.

However it's turned off, pending proposals stay in Mine until they're
decided or expire.
