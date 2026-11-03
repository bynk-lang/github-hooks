# Register the GitHub App

github-hooks receives events from a GitHub App rather than a plain
organisation webhook. The App gives the service its own identity
(`<app-name>[bot]`), permissions scoped to what it needs, and short-lived
installation tokens for phase 3, when it starts acting on events. Its webhook is
the same signed POST either way, so phase 1 needs only the webhook secret.

## 1. Choose a webhook secret

```sh
openssl rand -hex 32
```

Keep it somewhere safe: it goes into both the App and the Worker.

## 2. Create the App

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

## 3. Permissions and events

GitHub only offers an event once the App has a permission that covers it, so
choose permissions first. Phase 1 only reads, so every permission is
**Read-only**:

| Permission (Repository) | Unlocks events such as |
|---|---|
| Metadata (mandatory) | `repository`, `star`, `fork`, `create`, `delete` (per GitHub's list) |
| Contents | `push`, `release` |
| Issues | `issues`, `issue_comment` |
| Pull requests | `pull_request`, `pull_request_review`, `pull_request_review_comment` |
| Actions | `workflow_run`, `workflow_job` |
| Discussions | `discussion`, `discussion_comment` |

Then tick the events you want under **Subscribe to events**. `installation` and
`installation_repositories` are sent without being ticked, and so is the
`ping` GitHub sends when the webhook is created.

Phase 3 will need some of these raised to **Read and write** (Issues and Pull
requests, for comments and labels). Changing an App's permissions asks an
organisation owner to approve the change on the installation; nothing else has
to move.

## 4. Install it

From the App's page, **Install App → bynk-lang**, and choose all repositories or
a selection. Repositories added later arrive as `installation_repositories`
events.

## 5. Give the Worker the secret

```sh
printf 'GITHUB_WEBHOOK_SECRET=%s\n' "<the secret from step 1>" > .secrets.env
bynk deploy --secrets-file .secrets.env
```

`.secrets.env` is ignored by git. Delete it once the deploy has run.

## 6. Check it

The App's **Advanced** tab lists recent deliveries with GitHub's request and
the Worker's response. The first one is the `ping`, answered
`202 recorded`. Any delivery can be redelivered from there, and a redelivery is
answered `200 duplicate`.

## Later: the private key (phase 3)

Phase 3 signs a short-lived JWT as the App and exchanges it for an installation
token. Generate a private key on the App's page then. GitHub gives it as PKCS#1
PEM; Bynk's crypto imports PKCS#8, so convert it once:

```sh
openssl pkcs8 -topk8 -nocrypt -in bynk-bot.private-key.pem -out bynk-bot.pkcs8.pem
```

The key will be a Worker secret like the webhook secret. It never goes in the
repository.
