-- Phase 4, slice 2, step 3 (#26): indexes for the public PR flow routes.

-- Closed without merging, over a window.
CREATE INDEX pull_requests_by_closed ON pull_requests (closed_at) WHERE state = 'closed';

-- Moments by kind over a window: why pull requests left the merge queue.
CREATE INDEX pull_request_events_by_action ON pull_request_events (action, at);
