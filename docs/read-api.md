# Read API

Recorded activity is read over three `GET` routes. Each needs a token, and
answers JSON.

## Tokens

The `Reader` actor accepts a JWT signed with HS256 under the Worker's
`API_TOKEN_SECRET`. The compiler generates the check, including `exp` and
`nbf`, so a missing, forged or expired token is answered `401` before any
handler runs. The token's `sub` names the reader, and each read is logged under
that name (`me listed activity`).

Mint one with:

```sh
API_TOKEN_SECRET=… scripts/token.sh <reader-name> [lifetime-seconds]   # default 30 days
```

and send it as `Authorization: Bearer <token>`. Anyone holding the secret can
mint tokens, so keep it as you would the webhook secret. To revoke every token
at once, rotate the secret and redeploy.

## Routes

| Route | Answers |
|---|---|
| `GET /activity` | the 50 most recent deliveries, newest first |
| `GET /activity/:owner/:name` | the 50 most recent deliveries for one repository, for example `/activity/bynk-lang/bynk` |
| `GET /digest/:day` | one UTC day's deliveries counted by repository, event and action, busiest first; `:day` is `YYYY-MM-DD` |

```sh
TOKEN=$(API_TOKEN_SECRET=… scripts/token.sh me)
BASE=https://github-hooks.<subdomain>.workers.dev

curl -H "Authorization: Bearer $TOKEN" $BASE/activity
curl -H "Authorization: Bearer $TOKEN" $BASE/activity/bynk-lang/bynk
curl -H "Authorization: Bearer $TOKEN" $BASE/digest/2026-11-03
```

A `:day` that isn't `YYYY-MM-DD` (`/digest/yesterday`) is refused with `400` at
the boundary, by the `Day` type's refinement.

### `GET /activity`, `GET /activity/:owner/:name`

A list of deliveries, each a row of the `deliveries` table:

```json
{
  "id": "72d3162e-cc78-11e3-81ab-4c9367dc0958",
  "event": "issues",
  "action": { "kind": "Some", "value": "opened" },
  "repo": { "kind": "Some", "value": "bynk-lang/github-hooks" },
  "sender": { "kind": "Some", "value": "octocat" },
  "org": { "kind": "Some", "value": "bynk-lang" },
  "installation": { "kind": "Some", "value": 178078395 },
  "deleted": { "kind": "None" },
  "size": 12021,
  "received_at": "2026-11-03T06:00:54.761Z"
}
```

Optional fields use Bynk's tagged JSON form, `{"kind": "Some", "value": …}` or
`{"kind": "None"}`. `deleted` is set only on a `push`: `true` when the push
deleted a branch or tag.

### `GET /digest/:day`

```json
{
  "day": "2026-11-03",
  "total": 4,
  "tallies": [
    { "repo": { "kind": "Some", "value": "bynk-lang/bynk" }, "event": "issues", "action": { "kind": "Some", "value": "opened" }, "deliveries": 2 },
    { "repo": { "kind": "Some", "value": "bynk-lang/bynk" }, "event": "delete", "action": { "kind": "None" }, "deliveries": 1 },
    { "repo": { "kind": "Some", "value": "bynk-lang/bynk" }, "event": "push", "action": { "kind": "None" }, "deliveries": 1 }
  ]
}
```

What the counts mean:

- **Deleting pushes are left out.** GitHub sends a `push` with `deleted: true`
  beside each `delete` event, and only the `delete` is counted. Pushes recorded
  before the `deleted` column existed (v0.1.0) can't be told apart and are
  counted.
- **A review reply counts as a review.** GitHub sends each reply to a review
  comment as a one-comment `pull_request_review` (`submitted`) as well as a
  `pull_request_review_comment`.
- **A release is three deliveries:** `created`, `published` and `released`.

## Limits

The routes are paths, not query strings, because Bynk handlers can't read a
query string yet (bynk-lang/bynk#2854). So there is no filter by event, no
`since`, and no paging past the most recent 50. Those come with typed query
parameters.
