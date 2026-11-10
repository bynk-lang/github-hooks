# Deploy from GitHub Actions

`.github/workflows/deploy.yml` deploys the Worker to production with
[`bynk-deploy`](https://github.com/bynk-lang/bynk-deploy) (#62). The Worker's
secrets are Actions secrets in the repository's `production` environment, one
per name, instead of a local `.secrets.env`.

## When it runs

| Trigger | What happens |
|---|---|
| A pull request | **Plan:** a dry run of what deploying it would change. It never authenticates and reads no secrets. |
| Pushing a `v*` tag | **Deploy** of the tagged commit, once the checks and smoke pass on it. The tag must be on `main`. |
| *Run workflow* (manual) | **Deploy** of `main`, the same way. Two options: *check only*, and *overwrite secrets*. |

`main` itself never goes live on its own: a release tag (or a manual run)
deploys it. Production deploys run one at a time and are never cancelled
halfway.

After a deploy, the job checks the live Worker: `/about`, and the CI figures
for a branch unique to the run, which skips the edge cache and reads D1. A failure there fails the run but rolls nothing
back.

## The environment

Create `production` under *Settings → Environments*. Under **Deployment
branches and tags**, choose *Selected branches and tags* and allow the branch
`main` and the tag pattern `v*`. GitHub enforces that rule whatever a workflow
says. Without it, a pull request from a branch that edits `deploy.yml` (or adds
a workflow) could name `environment: production` and read every secret below:
the guards in `deploy.yml` only bind the copy on `main`. Required reviewers are
optional on top: each deploy then waits for an approval.

## The secrets

Set these under *Settings → Environments → production → Environment secrets*:

| Name | Needed |
|---|---|
| `CLOUDFLARE_API_TOKEN` | always: a token that can edit the account's Workers, D1 and KV |
| `CLOUDFLARE_ACCOUNT_ID` | always |
| `APP_WEBHOOK_SECRET` | the Worker's: see [github-app.md](github-app.md) step 2 |
| `API_TOKEN_SECRET` | the Worker's: signs [read API](read-api.md) tokens |
| `MAINTAINER_TOKEN_SECRET` | the Worker's: signs [maintainer](maintainers.md) sessions |
| `APP_CLIENT_ID` | the Worker's: the GitHub App's client ID |
| `APP_PRIVATE_KEY` | the Worker's: the App's key, the same base64 PKCS#8 line as in `.secrets.env` |
| `APP_CLIENT_SECRET` | the Worker's: the App's client secret, for maintainer sign-in |
| `ACTION_REPOS` | optional: see [github-app.md](github-app.md) step 7 |
| `DASHBOARD_EXCLUDE` | optional |
| `WELCOME_ASSOCIATIONS` | optional |

Enter each value exactly as it is in `.secrets.env`, on one line, without
quotes, and delete `.secrets.env` once they're in. Each value becomes one line
of the deploy's secrets file, so the deploy refuses a value with a line break
(for the key, make it with `base64 -w0`). The lock pull request also uses the
organisation's `BUMP_APP_ID` and `BUMP_APP_KEY`, which are already shared with
this repository; they don't go in the environment.

**How the deploy uses them.** The deploy only sets a secret the Worker doesn't
have yet, so a routine deploy changes none, and needs only the two Cloudflare
ones. The Worker's names are kept in the environment as the source of truth:
to set up a new Worker, and to overwrite after a rotation. A name whose Actions
secret isn't set is left out of the deploy altogether, rather than passed as an
empty value, so an optional setting that's left unset stays unset.

**Check only.** A manual run with *check only* lists every name as set or
missing in the run's summary, with no values, and deploys nothing. Use it after
changing the environment. It fails if a Cloudflare secret is missing, and warns
about any of the Worker's names that are.

**Rotating a secret.** Change the Actions secret, then run the workflow with
*overwrite secrets*. That re-sets every name that has an Actions secret, from
the environment. Rotating `API_TOKEN_SECRET` or `MAINTAINER_TOKEN_SECRET`
invalidates every token or session signed with the old value.

## The lock file

`bynk.deploy.lock` records what the deploys have set up, and must be
committed. It holds no secrets: the ids of the KV namespace, the D1 database
and the rate limiters, and the contexts deployed. A deploy changes it only when
it creates something new, which is when a reviewer should look. Since Bynk
v0.525 it no longer lists each static asset by its hashed name
(bynk-lang/bynk#3072), so a release that only changes the pages leaves it as
it is. (v0.2.0 and v0.3.0 each needed a follow-up pull request for just that.)

**After a release that creates something.** A tag's deploy can't open a pull
request for the new lock (a tag isn't a branch to open one against), so it
keeps the lock as the run's `bynk.deploy.lock` artifact: download it from the
run's page (*Artifacts*, at the bottom) or with
`gh run download <run id> -n bynk.deploy.lock`, and commit it. Or run *Deploy*
manually on `main`: it redeploys the same code, and opens the lock pull
request itself, through the organisation's bump App.

**Before the first deploy from CI.** The committed lock must hold everything
the last deploy by hand set up. The driver won't create again what a lock
should already record, such as a rate limiter, since a second one wouldn't be
the one that's live: it stops, naming it, and asks for the lock. v0.2.0's
first tag hit this, as the rate limiters had only ever been recorded in a
local lock. So commit the lock from the last local deploy first.

## Going back

`bynk revert` makes the previous deployment live again, without a rebuild
(bynk-lang/bynk#3073). It drives Cloudflare's version rollback, but checks
first what would make that unsafe, and refuses, changing nothing, on any of
them:
- **D1 migrations** the live version applied: the previous code may not run on
  the newer schema. Most of this Worker's releases add one, so a release that
  did is usually not revertible; redeploy the previous tag instead, or fix
  forward.
- **Agent state** stamped with a newer schema version (the live boards), which
  older code would fault on.
- **A replaced resource id**, or **a secret change** since that deployment.

Run `bynk revert --dry-run` first: it prints each check's verdict and stops.
Both need `CLOUDFLARE_API_TOKEN` (with D1 read access) and
`CLOUDFLARE_ACCOUNT_ID`. Only versions deployed by a Bynk that records deploy
facts (v0.525 on) can be reverted, so the first revertible release is the
first one deployed after this move.

## By hand

`bynk deploy --secrets-file .secrets.env` still works, as in
[github-app.md](github-app.md), for a first deploy before the environment
exists, or when Actions isn't available.
