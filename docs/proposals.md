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

The foundations (#88) are in place, and **issue triage** is the first feature
that proposes ([below](#issue-triage)). Each feature arrives as its own slice
of #69, and this page gains a section for each:

| Feature | Slice | Claude | Proposes |
|---|---|---|---|
| [Issue triage](#issue-triage) (#95) | 2, built | Haiku 5.5 | labels for a new issue, from the repository's allowed list |
| Stale pull request nudges | 3 | none | a comment to a ready pull request's reviewers |
| Release notes drafts | 4 | Opus 5.5 | notes for a release, from the pull requests it shipped |
| Weekly summary | 5 | Opus 5.5 | the organisation's week, posted to a Discussion |

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
  title and body. This is anyone's text, and may try to give instructions.
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
  summary), a steered reply *is* the action. Each of those slices will state
  its own reach, and what a maintainer should check, in its section here.

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

## What is kept

| What | Where | For |
|---|---|---|
| Each call: when, which repository and feature, the model asked and the model that answered, how it stopped, the token counts, the outcome, and the proposal it made | `claude_calls` | 90 days |
| Calls per repository per UTC day | `claude_calls_daily` | 7 days |
| Each proposal: its target and title, what it would do, Claude's reason, and how it was decided | `proposals` | pending for up to 14 days; 90 days after a decision |
| Each decision: who, which proposal, GitHub's status and what happened | `maintainer_actions` | kept |
| What each repository's settings file said when last read | `repo_settings` | kept, one row per repository; Mine shows the last 7 days |

The App does **not** keep the text it sends to Claude (an issue's body,
say), nor Claude's reply beyond what the proposal holds. What Anthropic
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
3. **The App's permissions.** The App already has what the foundations need:
   **Contents: Read-only** for the settings file, and **Issues: Read and
   write** to apply labels ([github-app.md](github-app.md)). A later
   feature that needs more says so in its own section.
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
