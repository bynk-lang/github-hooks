# Repository settings

Phase 5's features (#69) are switched on, and tuned, per repository by a file
on its default branch: **`.github/bynk-hooks.yml`**
([proposals.md](proposals.md) is phase 5's overview). Settings change by pull
request, with the code they apply to. Every feature is **off** in a
repository without the file, so the App sends nothing of a repository's to
Claude, and proposes nothing there, until its maintainers say so.

```yaml
# .github/bynk-hooks.yml
triage:
  enabled: true
  labels: [bug, enhancement, documentation]   # the only labels it may suggest
nudges:
  enabled: true
  after_days: 5
release_notes:
  enabled: true
```

| Key | Default | Meaning |
|---|---|---|
| `triage.enabled` | `false` | suggest labels for each new issue (#69, slice 2) |
| `triage.labels` | `[]` | the only labels triage may suggest |
| `nudges.enabled` | `false` | propose a nudge for a ready pull request waiting on review (#69, slice 3) |
| `nudges.after_days` | `3` | how many days it waits first: 1 to 30 |
| `release_notes.enabled` | `false` | draft notes for each release (#69, slice 4) |

Any section or key left out takes its default. No feature reads these yet;
each slice of #69 reads its own section as it lands.

## How it's read

The file is YAML, read by Bynk's `Yaml.decode` into a typed record
(`RepoSettings`, in `src/github/settings.bynk`), so the rules are in the
types. Bynk reads a safe subset of YAML 1.2:

- `true` and `false` are booleans; **`yes`, `no`, `on` and `off` are text**,
  and are refused where a boolean belongs;
- anchors, aliases, merge keys, tags and a second document are refused;
- indent with spaces, not tabs.

A file that's **empty**, or holds only comments, is the same as no file:
everything is off.

A file that **doesn't decode** turns every feature off in its repository, and
Mine says why, with where: for `after_days: 90`,

```text
RefinementViolation at $.nudges.after_days: …
```

A key the App **doesn't know** is ignored, and Mine lists it, as it's most
often a misspelling that leaves a feature at its default (`after_day: 5`
leaves `after_days` at `3`). The App finds these by reading the file's text:
keys at the top level, and keys directly inside `triage`, `nudges` and
`release_notes` written one to a line. Keys inside a section written in flow
style (`triage: {enabled: true}`) aren't checked.

## Where it's read from, and when

The App reads the file with the contents API, as the repository's
installation, from the default branch. That needs the **Contents: Read-only**
permission, which the App already has for `push` and `release` deliveries
([github-app.md](github-app.md#4-permissions-and-events)). Without it GitHub
refuses the read with a `403`, every feature is off there, and Mine names the
permission.

- **Cached for a day.** The file's text (or that there's none) is kept in KV
  (`settings:<owner>/<repo>`, lower case) for 24 hours.
- **A refusal is remembered for ten minutes.** A file GitHub won't give, or
  that isn't a file of text, isn't cached, but it's remembered
  (`settings-unreadable:<owner>/<repo>`) for ten minutes. In that time every
  feature takes the settings as off without asking GitHub, so a repository
  without the permission costs one read every ten minutes, not one on every
  delivery.
- **Read again on a push.** A `push` to the default branch with a commit that
  adds, changes or removes the file drops both, and reads the file at once,
  so Mine shows a refused file while its author is still looking.
  - It reads the file **at the pushed commit** (`?ref=<after>`): GitHub can
    briefly answer for a branch as it was before a push it has just
    announced.
  - That read is kept for ten minutes, not a day, in case the delivery of a
    later push arrived first.
  - GitHub lists at most 20 commits in a `push`, so a push of 20 or more
    counts too.
  - KV takes up to a minute to forget a value everywhere, so a feature may
    see the old settings for that long.
- **Recorded for Mine.** Each read from GitHub rewrites the repository's row
  in `repo_settings` (migration `0025`): `missing`, `decoded` (with any keys
  ignored), `invalid` (with the decoder's reason) or `unreadable` (with
  GitHub's answer).

## In Mine

`GET /maintainers/mine` has **`settings`**: the repositories whose file is
`invalid` or `unreadable`, or `decoded` with keys the App ignored, by name
([maintainers.md](maintainers.md#whats-yours)). Only reads in the last
seven days count. A file in use is read at least daily, so an older row is a
repository nothing asks about any more: one the App was removed from, or that
was renamed or deleted. Every signed-in page shows
them near the top, under **Settings files to fix**, each linked to its file.
They're every maintainer's, like the proposals. A file that's fixed leaves
the list when the push that fixes it is read.
