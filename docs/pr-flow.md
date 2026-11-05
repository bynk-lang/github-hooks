# PR flow

The second slice of the public dashboard
([#26](https://github.com/bynk-lang/github-hooks/issues/26)): how long pull
requests take to land, what is open now, and how the merge queue behaves. This
page covers what is recorded and how it is kept correct; the routes and the page
come next.

## What is recorded

Migration `0006` adds three tables, filled as deliveries arrive and kept
indefinitely (retention prunes `deliveries`, not these).

- **`pull_requests`**: one row per pull request, from any `pull_request`
  delivery (each carries the whole PR) and from the daily sync below. A row
  only moves forward by `updated_at`. On a same-second tie the newer source
  applies unless it would take the PR out of `merged`, which is final.
  `ready_at` is `created_at` for a PR opened ready, else the `ready_for_review`
  delivery's `updated_at`, and only ever moves earlier. Sizes and `commits`
  come only from deliveries and from reading one PR (the list endpoint omits
  them), and keep their last known values.
- **`pull_request_events`**: the moments a row can't hold (`enqueued`,
  `dequeued` with GitHub's `reason`, `ready_for_review`, `converted_to_draft`,
  `closed`, `reopened`), keyed by delivery so a redelivery adds nothing, and
  timed by when the delivery arrived. GitHub sends `dequeued` with reason
  `MERGE` when a PR leaves the queue by merging, so only other reasons mean
  the queue turned a PR away.
- **`pull_request_reviews`**: each review, keyed by GitHub's review id.
  `dismissed` is final. Recorded but not shown yet.

## The daily sync

Deliveries alone miss two things: pull requests opened before the service saw
them, and a `closed` delivery that never arrived (which would leave a PR open
for good). The `pullSync` cron service, daily at 04:41 UTC, repairs both:

1. For each public repository (not in `DASHBOARD_EXCLUDE`), it lists the open
   pull requests through the REST API as the installation that last delivered
   for that repository (up to 500, a page of 100 at a time), and saves each.
2. Each pull request the table still holds open that GitHub didn't list is read
   on its own and saved as it now is: merged or closed, with its times. At most
   50 a repository per run.

The sync never sets `ready_at`: the pulls API doesn't say when a PR became
ready. So a PR it fills in counts towards "opened → merged" but not "ready →
merged".

It reads as the App, with the installation token welcomes already use, so it
needs only the **Pull requests: Read** permission the App already has. A
refused call is retried once with a fresh token, as comments are. One
repository failing doesn't stop the others; the run then fails, naming each,
and logs a line per repository:

```text
pull request sync: bynk-lang/bynk has 5 open, 0 repaired
```
