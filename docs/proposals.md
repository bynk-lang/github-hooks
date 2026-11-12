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

The foundations (#88) are in place. **No feature proposes anything yet.**
Each feature arrives as its own slice of #69, and this page gains a section
for each:

| Feature | Slice | Claude | Proposes |
|---|---|---|---|
| Issue triage | 2 | Haiku 5.5 | labels for a new issue, from the repository's allowed list |
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
  Each feature's section here will say what else they include. As #69
  plans triage, that's the repository's allowed labels with their
  descriptions.
- **The material to work on**, as the user turn: for triage, as planned,
  the issue's title and body. This is anyone's text, and may try to give
  instructions. It goes in the user turn as a quoted string, never the
  system prompt. The instructions say it is data to classify, not
  instructions to follow.
- **The schema the reply must match.** For triage, as planned, the label
  field is a list chosen from the allowed labels, so Claude can't invent
  one.

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
keeps of a request is set by its API terms ([above](#what-is-sent-to-anthropic-and-when)). The logs name the feature,
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
