# Maintainers view

The last slice of the dashboard
([#53](https://github.com/bynk-lang/github-hooks/issues/53)): a signed-in view
for bynk-lang's maintainers, covering private repositories, what is theirs to
act on, and actions such as re-running a flaky run. This page covers signing
in (step 1) and the maintainers' figures (step 2). The signed-in pages, the
per-person view and the actions follow in later steps.

## Who may sign in

A maintainer is a member of the `bynk-lang` organisation, public or private.
That's checked twice, with the cached lookup issue response uses
([issues.md](issues.md)), which needs the App's **Members: Read** permission:

- **At sign-in:** the Worker asks GitHub who signed in, then whether they
  belong to the organisation, **fresh**, never from a kept answer. Someone who
  doesn't gets no token. The fresh answer is kept, so it also updates what
  the per-request check sees.
- **On every maintainer request:** the Worker asks again. Each answer is kept
  a day, so someone who leaves the organisation loses access within a day,
  even with a token that hasn't expired.
  - **A kept answer comes first:** while one is fresh, the Worker doesn't
    look for an installation at all.
  - **Otherwise:** it asks through the installation that last delivered for
    one of the organisation's repositories. It finds that installation from
    each repository's latest delivery, so the cost grows with the number of
    repositories, not deliveries.

## Signing in with GitHub

Maintainers sign in with **GitHub, through the GitHub App's user
authorisation**. Identity is the **GitHub login**, straight from GitHub's
`GET /user`, which the per-person view uses to match people to their pull
requests and issues.

Cloudflare Access was tried first and dropped: its GitHub login method passes
on only a name, an email address and organisations, never the GitHub login.

The Worker then issues **its own token**: an HS256 JWT whose `sub` is the
GitHub login, signed with `MAINTAINER_TOKEN_SECRET`, lasting a working day (8
hours). The `Maintainer` actor (Bynk's `Bearer`) verifies it, including `exp`
and `nbf`, and answers `401` to a missing, forged or expired one. GitHub's own
user token is used once, to ask who signed in, then revoked
(`DELETE /applications/{client_id}/token`), so nothing usable is left behind.
A failed revocation is logged as a warning and doesn't stop the sign-in.

## Setting it up

In the GitHub App's settings (*Settings → Developer settings → GitHub Apps →
the App*):

1. **Callback URLs:** add
   `https://github-hooks.bynk-lang.workers.dev/maintainers/callback`, and
   `http://localhost:8787/maintainers/callback` for `bynk dev`.
2. **Client secret:** generate one under *Client secrets*.
3. **Leave the rest:** *Request user authorization (OAuth) during
   installation* stays off. *Expire user authorization tokens* can stay on.

Then add the two new secrets to a `.secrets.env` and deploy:

```sh
printf 'APP_CLIENT_SECRET=%s\n' "<the client secret from step 2>" > .secrets.env
printf 'MAINTAINER_TOKEN_SECRET=%s\n' "$(openssl rand -hex 32)" >> .secrets.env
bynk deploy --secrets-file .secrets.env
```

`APP_CLIENT_ID` is already set for acting as the App
([github-app.md](github-app.md)), and sign-in reuses it.

The first time each maintainer signs in, GitHub asks them to authorise the
App to know who they are. That grant can be revoked in their GitHub settings
(*Applications → Authorized GitHub Apps*).

## The flow

Every dashboard loads `assets/signin.js`, which puts a **Maintainer sign-in**
link in the page's navigation. Once signed in, the link reads *Signed in as
login · Sign out*.

1. **Starting:** the page fetches `GET /maintainers/config` and makes a PKCE
   verifier and challenge, plus a random `state`. It sends the browser to
   GitHub's authorisation page, remembering where the sign-in started (in
   `sessionStorage`).
2. **Returning:** GitHub returns to `/maintainers/callback` with a code. The
   callback page checks the `state`, then posts the code and verifier to
   `POST /maintainers/token`.
3. **Finishing:** the Worker exchanges the code at GitHub with the App's
   client secret, asks GitHub who signed in, and checks they belong to the
   organisation. It answers its own token, how long it lasts, and the login.
   The page keeps them in `sessionStorage`, so they last as long as the tab,
   and goes back to where the sign-in started.
4. **Signing out:** this forgets the token in the tab. GitHub's own session is
   GitHub's, so the next sign-in may not ask again.
   - **Not yet server-side:** a token copied elsewhere stays valid until it
     expires, up to 8 hours, or until a membership recheck refuses it. Ending
     a session on the server (a per-login token version, bumped on sign-out
     or a membership change) is planned before step 5's actions.

Other scripts read the signed-in maintainer from `window.bynkMaintainer()`
(`null` when signed out or expired). They send the token as
`Authorization: Bearer` to the maintainer routes.

## Routes

| Route | Who | What |
|---|---|---|
| `GET /maintainers/config` | anyone | the sign-in settings: `authorization_endpoint` and `client_id`, both public |
| `GET /maintainers/callback` | anyone | the page GitHub returns to |
| `POST /maintainers/token` | anyone | finishes a sign-in: `{code, code_verifier, redirect_uri}` in, `{token, expires_in, login}` out |
| `GET /maintainers/me` | a maintainer | `{login}` |
| `POST /maintainers/metrics/…` | a maintainer | each public metrics route's figures, private and excluded repositories included ([below](#the-maintainers-figures)) |
| `GET /maintainers/repositories` | a maintainer | every repository: `[{repo, public, excluded}]` |

**`/maintainers/token`:**
- **Callback only:** the `redirect_uri` must be `/maintainers/callback` on
  the origin the request came to: `https://<host>/maintainers/callback`, where
  the host is the request's `Host` header. Plain `http` is accepted only for a
  local Worker (`localhost` or `127.0.0.1`). GitHub also checks it against the
  App's callback URLs.
- **Limit:** it shares the metrics routes' per-address limit.
- **A code alone is useless:** it works only with the verifier the page made,
  and the App's client secret, which only the Worker has.
- **Answers:** `400` when GitHub refuses the code (with GitHub's reason),
  `403` (`not_a_member`) for someone outside the organisation, `502` when
  GitHub can't be reached, and `503` when GitHub can't say whether they belong
  or sign-in isn't configured.

**`/maintainers/me`:**
- **`401`:** a token that fails verification is refused by Bynk before the
  handler runs.
- **`403`:** someone GitHub says has left the organisation.
- **`503`:** when GitHub can't say, or no installation has delivered for the
  organisation yet.

## The maintainers' figures

Every public metrics route has a maintainer twin, under `/maintainers`, with
the same figures and answer shape, over **every** repository: private ones,
and those `DASHBOARD_EXCLUDE` keeps off the public pages.

| Public | Maintainers' |
|---|---|
| `GET /metrics/ci` | `POST /maintainers/metrics/ci` |
| `GET /metrics/ci/now` | `POST /maintainers/metrics/ci/now` |
| `GET /metrics/ci/history` | `POST /maintainers/metrics/ci/history` |
| `GET /metrics/runners` | `POST /maintainers/metrics/runners` |
| `GET /metrics/runners/now` | `POST /maintainers/metrics/runners/now` |
| `GET /metrics/prs` | `POST /maintainers/metrics/prs` |
| `GET /metrics/prs/open` | `POST /maintainers/metrics/prs/open` |
| `GET /metrics/releases` | `POST /maintainers/metrics/releases` |
| `GET /metrics/releases/recent` | `POST /maintainers/metrics/releases/recent` |
| `GET /metrics/issues` | `POST /maintainers/metrics/issues` |
| `GET /metrics/issues/open` | `POST /maintainers/metrics/issues/open` |

- **The request:** the public route's query string, as a JSON body. For
  example, `{"days": 30, "repo": "bynk-lang/bynk"}` for
  `?days=30&repo=bynk-lang/bynk`. Fields the public route defaults (such as
  `days`) may be left out.
- **Why `POST`:** Bynk (v0.510.25 to v0.510.34) generates test code that
  doesn't compile for a `Bearer` route taking a query string when the project
  has a `system`-tier suite, as this one does. A JSON body avoids it. They can
  move to `GET` once that's fixed (bynk-lang/bynk#3024).
- **One query each:** a twin runs exactly the public route's SQL. Each query's
  exclusion parameter is given `*` instead of `DASHBOARD_EXCLUDE`'s names,
  which the query reads as "private repositories too" (`public = 1 OR ? =
  '*'`) and which matches no repository's name. The CI routes, which filter
  exclusions after reading, take a flag instead.
- **Never cached:** the twins carry no `@cache`. A `POST` answer is never kept
  by Cloudflare's cache or a browser's, and `GET /maintainers/repositories` is
  sent `no-store`. Nothing purges them, as nothing keeps them.
- **No per-address limit:** they need a maintainer's token, and every request
  checks membership (a kept answer first).
- **Marking:** `GET /maintainers/repositories` says which repositories are
  public and which are excluded, so the signed-in pages (step 3) can mark the
  ones only maintainers see.

## Settings

| Setting | Meaning |
|---|---|
| `APP_CLIENT_ID` | the GitHub App's client ID, shared with acting as the App. Without it, `GET /maintainers/config` answers `503`. |
| `APP_CLIENT_SECRET` | the App's client secret, for exchanging sign-in codes. Secret. |
| `MAINTAINER_TOKEN_SECRET` | signs maintainer tokens. Secret. Changing it signs every maintainer out. |

## Testing

- **Suites:**
  - `tests/maintainers.bynk` stubs GitHub's sign-in at its capability and
    gives the verified maintainer directly (`by Maintainer(login)`). It covers
    the token issued (pinned to one computed with Node's HMAC, so it's
    standard HS256), membership at sign-in and on each request, GitHub's
    refusals, and the callback rule.
  - `tests/maintainers-unset.bynk` covers sign-in before it's configured.
  - Each metrics suite (`tests/metrics.bynk`, `prs.bynk`, `issue-metrics.bynk`,
    `release-metrics.bynk`, `runners.bynk`) asks every public route and its
    maintainer twin about the same seed. The public answer never names the
    private or the excluded repository; the maintainer's names them.
    `tests/metrics.bynk` also covers `/maintainers/repositories`, and refusing
    a leaver.
- **End to end:** with `MAINTAINER_TOKEN_SECRET` set, `scripts/smoke.sh`
  mints tokens with `bynk token Maintainer` and checks that a missing, forged,
  expired or reader's token is refused with a `401`, and that a valid one
  reaches the membership check, for `/maintainers/me` and the maintainers'
  figures. It also checks `/maintainers/repositories` is sent `no-store`.
  CI's smoke job runs it.
- **By hand:** `bynk token Maintainer --sub <login>` mints a token for the
  maintainer routes, given the same `MAINTAINER_TOKEN_SECRET` as the Worker.
