# Maintainers view

The last slice of the dashboard
([#53](https://github.com/bynk-lang/github-hooks/issues/53)): a signed-in view
for bynk-lang's maintainers, covering private repositories, what is theirs to
act on, and actions such as re-running a flaky run. This page covers signing
in (step 1). The maintainer routes, the signed-in pages, the per-person view
and the actions follow in later steps.

## Who may sign in

A maintainer is a member of the `bynk-lang` organisation, public or private.
That's checked twice:

- **By Cloudflare Access, at sign-in:** the Access application's policy admits
  only members of the GitHub organisation.
- **By the Worker, on every maintainer request:** it asks GitHub whether the
  person belongs to the organisation, with the cached lookup issue response
  uses ([issues.md](issues.md)). That lookup needs the App's **Members: Read**
  permission, and keeps each answer a day. So someone who leaves the
  organisation loses access within a day, even with a token that hasn't
  expired.

## Cloudflare Access

Maintainers sign in through **Cloudflare Access acting as an OIDC provider**,
with GitHub as its only login method. Access issues an ID token, signed with
RS256, which Bynk's `Oidc` actor verifies against the application's published
keys. No secret is involved anywhere: the page uses PKCE, and the trust roots
are public.

The bynk-lang application:

| | |
|---|---|
| Team domain | `bynk-lang.cloudflareaccess.com` |
| Client ID (the token's audience) | `fba9900eff8cefeca28cc95d364cae191a747ead0d670a9d11c0c88451869d0a` |
| Issuer | `https://bynk-lang.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client id>` |
| JWKS | the issuer, then `/jwks` |
| Redirect URLs | `https://github-hooks.bynk-lang.workers.dev/maintainers/callback`, and `http://localhost:8787/maintainers/callback` for `bynk dev` |

Setting it up again, in the Cloudflare Zero Trust dashboard:

1. **GitHub as a login method:** *Settings → Authentication → Login methods →
   GitHub*.
   - **The OAuth App:** this needs a GitHub OAuth App whose callback is
     `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`.
   - **Org access:** the organisation must allow that OAuth App, or Access
     can't see who belongs to it.
2. **The application:** *Access → Applications → Add an application → SaaS*,
   using **OIDC**.
   - **Settings:** the redirect URLs above, the scopes `openid email profile`,
     and **PKCE** on.
   - **Login methods:** GitHub only.
3. **The policy:** an **Allow** policy that includes *GitHub organization =
   `bynk-lang`*.
4. **The GitHub login claim:** add a custom claim named `login`, taken from
   the GitHub login method's login attribute (see below).

Access's token endpoint doesn't answer a browser's cross-origin call, so the
page can't exchange the sign-in code itself. The Worker does it instead, at
`POST /maintainers/token`.

## The GitHub login

The per-person view matches people to their pull requests and issues by
**GitHub login**. Access's own `sub` is an Access user id, and an email address
may not match GitHub, so the token needs the login as a claim.

`/maintainers/me` looks for it under `login`, `github_login`,
`preferred_username` or `nickname`, in that order. A token without any of
these is refused with a `403` that names which of the claims it looks for
were present:

```json
{"error": "no_login", "message": "the token carries no GitHub login (looked for login, github_login, preferred_username, nickname); present: email, name"}
```

So the first sign-in shows whether the claim is configured. If it isn't, add it
in the application's claim settings (step 4 above).

## Signing in

Every dashboard loads `assets/signin.js`, which puts a **Maintainer sign-in**
link in the page's navigation. Once signed in, the link reads *Signed in as
login · Sign out*.

1. **Starting:** the page fetches `GET /maintainers/config` and makes a PKCE
   verifier and challenge, plus a random `state`. It sends the browser to
   Access's authorisation endpoint, remembering where the sign-in started (in
   `sessionStorage`).
2. **Returning:** Access returns to `/maintainers/callback` with a code. The
   callback page checks the `state`, then posts the code and verifier to
   `POST /maintainers/token`. The Worker exchanges them at Access's token
   endpoint and returns the ID token.
3. **Checking:** the page calls `GET /maintainers/me` with the token. It keeps
   the token, its expiry and the login in `sessionStorage`, so they last as
   long as the tab, and goes back to where the sign-in started.
4. **Signing out:** this forgets the token, and signs out of Access too, at
   the team domain's `/cdn-cgi/access/logout`.

Other scripts read the signed-in maintainer from `window.bynkMaintainer()`
(`null` when signed out or expired). They send the token as
`Authorization: Bearer` to the maintainer routes.

## Routes

| Route | Who | What |
|---|---|---|
| `GET /maintainers/config` | anyone | the sign-in settings: `authorization_endpoint`, `client_id`, `logout_url`, all public |
| `GET /maintainers/callback` | anyone | the page Access returns to |
| `POST /maintainers/token` | anyone | exchanges `{code, code_verifier, redirect_uri}` at Access for `{id_token, expires_in}` |
| `GET /maintainers/me` | a maintainer | `{sub, login, email, name, claims}` |

**`/maintainers/token`:**
- **Callback only:** the `redirect_uri` must end in `/maintainers/callback`.
- **Limit:** it shares the metrics routes' per-address limit.
- **A code alone is useless:** it works only with the verifier the page made.

**`/maintainers/me`:**
- **`401`:** a token that fails verification is refused by Bynk before the
  handler runs.
- **`403`:** a token with no GitHub login, or someone GitHub says isn't in the
  organisation.
- **`503`:** when GitHub can't say, or no installation has delivered for the
  organisation yet.

## Settings

| Setting | Meaning |
|---|---|
| `MAINTAINER_OIDC` | optional. JSON `{"issuer", "jwks", "audience"}`, replacing the declared Access application (Bynk's `trustFrom`). Not secret. Unset in production; CI's smoke job sets it to a fake issuer. |

## Testing

- **Suites:** `tests/maintainers.bynk` gives the verified principal and its
  claims directly (`by Maintainer(sub, TokenClaims.of([...]))`). It covers:
  - the login claims and the membership check;
  - the code exchange, with Access stubbed;
  - the settings derived from the trust.
- **End to end:** `scripts/oidc.mjs` serves a fake issuer's JWKS on localhost
  and signs tokens with it. Against a Worker started trusting it through
  `MAINTAINER_OIDC`, it checks:
  - no token, a forged signature, the wrong audience, and an expired token are
    each refused with a `401`;
  - a valid token with no login gets the `403`;
  - a valid one with a login reaches the membership check.

  CI's smoke job runs it (`SMOKE_OIDC=1`).

  Bynk allows 60 seconds of clock skew on `exp` and `nbf`, and refetches the
  JWKS for an unknown key id at most every 30 seconds. So run the script
  against a freshly started Worker.
