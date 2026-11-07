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

After a deploy, the job checks the live Worker: `/about`, and two public
metrics routes, which read D1. A failure there fails the run but rolls nothing
back.

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

Enter each value exactly as it is in `.secrets.env`, without quotes, and delete
`.secrets.env` once they're in. The lock pull request also uses the
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

A deploy that creates something new (a KV namespace, a D1 database, a context)
changes `bynk.deploy.lock`, which must be committed. A manual run from `main`
opens a pull request with the new lock, through the organisation's bump App. A
tag's deploy can't (a tag isn't a branch to open one against), so it keeps the
lock as the run's `bynk.deploy.lock` artifact, to commit by hand. Most deploys
change nothing in it.

## By hand

`bynk deploy --secrets-file .secrets.env` still works, as in
[github-app.md](github-app.md), for a first deploy before the environment
exists, or when Actions isn't available.
