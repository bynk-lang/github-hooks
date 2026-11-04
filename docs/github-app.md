# Register the GitHub App

github-hooks receives events from a GitHub App rather than a plain
organisation webhook. The App gives the service its own identity
(`<app-name>[bot]`), permissions scoped to what it needs, and short-lived
installation tokens for phase 3, when it starts acting on events. Its webhook is
the same signed POST either way.

## 1. Choose a webhook secret

```sh
openssl rand -hex 32
```

Keep it somewhere safe: it goes into both the Worker and the App.

## 2. Deploy the Worker with its secrets

Deploy first, so the Worker is already verifying signatures when GitHub sends
the App's first delivery. The Worker needs two secrets: the webhook secret, and
`API_TOKEN_SECRET`, which signs the [read API](read-api.md)'s tokens. Both are
declared by the code's actors, so a deploy that cannot find either one asks for
it (or fails, without a terminal).

```sh
printf 'APP_WEBHOOK_SECRET=%s\n' "<the secret from step 1>" > .secrets.env
printf 'API_TOKEN_SECRET=%s\n' "$(openssl rand -hex 32)" >> .secrets.env
bynk deploy --secrets-file .secrets.env
```

Keep `API_TOKEN_SECRET` somewhere safe too: `scripts/token.sh` needs it to mint
read-API tokens. Changing it later invalidates every token minted with the old
value.

`.secrets.env` is ignored by git. Delete it once the deploy has run. A secret
already set on the Worker is kept on later deploys (`bynk deploy` says
`already set … skipping`), so a later `.secrets.env` needs only the names that
are new; `--force` overwrites ones already set.

The name is `APP_WEBHOOK_SECRET` rather than anything starting `GITHUB_`
because GitHub refuses Actions secret names with that prefix. Keeping the
Worker's name and a future CI secret's name the same means a deploy from
GitHub Actions can pass it straight through. Note the
Worker's URL from the deploy output: `https://github-hooks.<subdomain>.workers.dev`.

## 3. Create the App

An organisation owner (or App manager) opens
**github.com/organizations/bynk-lang/settings/apps → New GitHub App**:

| Field | Value |
|---|---|
| GitHub App name | e.g. `bynk-bot` |
| Homepage URL | `https://github.com/bynk-lang/github-hooks` |
| Webhook → Active | ticked |
| Webhook URL | `https://github-hooks.<subdomain>.workers.dev/github` |
| Webhook secret | the secret from step 1 |
| SSL verification | enabled |
| Where can this GitHub App be installed? | Only on this account |

Leave callback URLs, device flow and "Request user authorization" empty or off.

## 4. Permissions and events

GitHub only offers an event once the App has a permission that covers it, so
choose permissions first. Phase 1 only reads, so every permission is
**Read-only**. From [GitHub's event list](https://docs.github.com/en/webhooks/webhook-events-and-payloads):

| Permission (Repository) | Unlocks events such as |
|---|---|
| Metadata (mandatory) | `repository`, `star`, `watch` |
| Contents | `push`, `release`, `create`, `delete`, `fork` |
| Issues | `issues`, `issue_comment` |
| Pull requests | `pull_request`, `pull_request_review`, `pull_request_review_comment` |
| Actions | `workflow_run`, `workflow_job` |
| Discussions | `discussion`, `discussion_comment` |

Then tick the events you want under **Subscribe to events**. Every App receives
`installation` and `installation_repositories` without subscribing, and GitHub
sends a `ping` when the webhook is created.

Phase 3 will need some of these raised to **Read and write** (Issues and Pull
requests, for comments and labels). Changing an App's permissions asks an
organisation owner to approve the change on the installation; nothing else has
to move.

## 5. Install it

From the App's page, **Install App → bynk-lang**, and choose all repositories or
a selection. Repositories added later arrive as `installation_repositories`
events.

## 6. Check it

The App's **Advanced** tab lists recent deliveries with GitHub's request and
the Worker's response. The first one is the `ping`, answered `202 recorded`.
If it failed (the Worker wasn't deployed yet, or the secrets don't match), fix
that and use **Redeliver**: a delivery that failed was never recorded, so the
redelivery is answered `202 recorded`, and redelivering one that succeeded is
answered `200 duplicate`.

## 7. Let the App act (phase 3)

Phase 3 lets the service act as the App: today it welcomes a first-time
contributor's first issue or pull request with a comment. It signs a
short-lived JWT as the App with the App's private key, exchanges it for an
installation token (cached for 55 minutes), and comments with that token. It
acts only in repositories you list.

**Permissions.** On the App's page, raise **Issues** and **Pull requests** to
**Read and write**. GitHub asks an organisation owner to approve the change on
the installation; approve it there.

**Repositories.** Add `bynk-lang/github-hooks-sandbox` to the installation
(**Install App → Configure → Repository access**).

**The App's credentials.**

1. **Client ID:** shown at the top of the App's **General** page (`Iv1.…` or
   `Iv23…`).
2. **Private key:** under **Private keys → Generate a private key**. GitHub
   downloads a PKCS#1 PEM. Bynk's crypto imports PKCS#8, so convert it, as one
   line of base64:

   ```sh
   openssl pkcs8 -topk8 -nocrypt -in github-hooks.private-key.pem -outform DER | base64 -w0
   ```

   (On macOS, `base64` without `-w0`.) Delete the downloaded `.pem` once the
   key is deployed. It never goes in the repository.

**Configuration.** Put these in a new `.secrets.env`. The secrets from step 2
are already on the Worker and are kept, so they needn't be repeated. If
`bynk deploy` asks for `API_TOKEN_SECRET`, the Worker predates the read API:
generate one as in step 2 and add it here too.

```sh
APP_CLIENT_ID=Iv23…
APP_PRIVATE_KEY=MIIEv…            # the base64 line from above
ACTION_REPOS=bynk-lang/github-hooks-sandbox
# Only while testing in the sandbox, where every author is a member:
WELCOME_ASSOCIATIONS=FIRST_TIMER,FIRST_TIME_CONTRIBUTOR,OWNER,MEMBER
```

| Name | Meaning |
|---|---|
| `APP_CLIENT_ID` | the App's client ID, the JWT's `iss` |
| `APP_PRIVATE_KEY` | the App's private key, base64 PKCS#8 |
| `ACTION_REPOS` | comma-separated `owner/name` list the service may act in. Unset or empty: it acts nowhere |
| `WELCOME_ASSOCIATIONS` | optional. Which `author_association` values earn a welcome. Default `FIRST_TIMER,FIRST_TIME_CONTRIBUTOR` |

**Deploy** with `bynk deploy --secrets-file .secrets.env`. The first deploy
creates the `Tokens` KV namespace and records its id in `bynk.deploy.lock`, so
commit the updated lock afterwards. It also applies migration `0003` (the
`actions` and `welcomed` tables). These names are read with `Secrets.get`, so a missing one is a
warning at deploy, not a failure: the service then logs `APP_CLIENT_ID is not
set` (or similar) and records the action as failed.

**Try it.** Open an issue in `bynk-lang/github-hooks-sandbox`. Within a few
seconds the App comments with the welcome from `embeds/welcome.md`, as
`<app-name>[bot]`. If nothing appears:

- the Worker's logs (`bynk tail`, or the dashboard) say why: `skipped: not in
  ACTION_REPOS`, `could not welcome …: <reason>`, or nothing at all if the
  author's association isn't welcomed;
- the `actions` table records each attempt's `status` and `detail`:

  ```sql
  SELECT * FROM actions ORDER BY at DESC LIMIT 10;
  ```

- a failed welcome is retried by redelivering its delivery from the App's
  **Advanced** tab. A welcome that worked is never repeated, and one left
  half-done (the Worker stopped mid-action) can be retried after 10 minutes.

**Who is welcomed, exactly.** A person is welcomed at most once per repository
(the `welcomed` table), on an opened issue or pull request whose
`author_association` is in `WELCOME_ASSOCIATIONS`. GitHub's associations are
about commits, which has two consequences:

- **Pull requests:** GitHub reports `FIRST_TIME_CONTRIBUTOR` on every pull
  request until one is merged; the `welcomed` table is what stops a second
  welcome.
- **Issues:** someone who has never committed to the repository is likely
  reported as `NONE`, so with the default associations most first issues are
  not welcomed. Adding `NONE` to `WELCOME_ASSOCIATIONS` welcomes each such
  person once, on the first issue or pull request the service sees from them.
  Check real payloads in the sandbox before choosing.

**Permissions changed?** A token is minted with the installation's permissions
at that moment and cached for up to 55 minutes. If GitHub refuses a comment
with `401` or `403`, the cached token is dropped and the comment retried once
with a fresh one, so approving write access takes effect immediately.

**Widening it.** When it works in the sandbox, remove `WELCOME_ASSOCIATIONS`
(back to first-timers only) and add repositories to `ACTION_REPOS`, then
redeploy.
