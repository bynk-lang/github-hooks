// Issues page (#48): reads the public issue routes and redraws. Everything that
// came from GitHub (repository names, titles, labels, authors) is set with
// textContent, never as markup.
(() => {
  "use strict";

  const OPEN_EVERY_MS = 30_000;     // the backlog and what has gone quiet
  const FLOW_EVERY_MS = 60_000;     // the window's figures move more slowly
  const LIVE_POLL_MS = 120_000;     // while the live feed is up, polling is only a safety net
  const CACHE_MS = 30_000;          // the routes' `max-age` at the edge
  const MAX_LABELS = 8;             // labels shown by time to close; the rest fold away
  let days = 7;
  let flow = null;
  let open = null;
  const fresh = { flow: { lastOk: null, failing: false }, open: { lastOk: null, failing: false } };
  let live = false;

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) {
      if (child == null) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  const duration = (seconds) => {
    if (seconds == null) return null;
    const s = Math.round(seconds);
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.floor(s / 60)} m ${s % 60} s`;
    const h = Math.floor(s / 3600);
    if (h < 48) return `${h} h ${Math.floor((s % 3600) / 60)} m`;
    return `${Math.floor(h / 24)} days`;
  };
  const since = (iso) => duration((Date.now() - Date.parse(iso)) / 1000);
  const when = (iso) =>
    new Date(iso).toLocaleString("en-GB", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
    }) + " UTC";
  const dayLabel = (day) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const clock = (d) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // Signed in (#53), the maintainers' twin of each route, private and
  // excluded repositories included; otherwise the public route (signin.js).
  const figures = (path, query) => window.bynkMetrics(path, query);
  const signedIn = () => Boolean(window.bynkMaintainer && window.bynkMaintainer());
  const repoMark = (name) => (window.bynkRepoMark ? window.bynkRepoMark(name) : null);

  async function refreshFlow() {
    const asked = days;
    try {
      const f = await figures("/metrics/issues", { days: asked });
      if (asked !== days) return; // the window changed while this was in flight
      flow = f;
      ok("flow");
    } catch (e) {
      if (asked !== days) return;
      failed("flow", e);
    }
    render();
  }

  async function refreshOpen() {
    try {
      open = await figures("/metrics/issues/open");
      ok("open");
    } catch (e) {
      failed("open", e);
    }
    render();
  }

  const refreshAll = () => { refreshFlow(); refreshOpen(); };
  const ok = (source) => { fresh[source] = { lastOk: new Date(), failing: false }; };
  function failed(source, e) {
    fresh[source].failing = true;
    console.warn(`Issues: refreshing ${source} failed:`, e.message);
  }

  function renderFreshness() {
    const f = $("freshness");
    const describe = (source, label) => {
      const s = fresh[source];
      if (!s.lastOk) return s.failing ? `${label}: couldn't load, retrying` : null;
      return s.failing ? `${label} from ${clock(s.lastOk)} UTC, retrying` : null;
    };
    const problems = [describe("open", "Open issues"), describe("flow", "Window figures")].filter(Boolean);
    const latest = [fresh.open.lastOk, fresh.flow.lastOk].filter(Boolean).sort((a, b) => b - a)[0];
    if (problems.length > 0) f.textContent = `${problems.join("; ")}.`;
    else if (latest) {
      f.textContent = live
        ? `${signedIn() ? "Public repositories live, private and not-public ones polled" : "Live"} · updated ${clock(latest)} UTC as issues change`
        : `Updated ${clock(latest)} UTC · refreshes every 30 seconds`;
    } else f.textContent = "Loading…";
    f.classList.toggle("stale", problems.length > 0);
  }

  // Closed-issue figures have no backfill, so say how much of the window they
  // cover. The backlog is synced daily, so it's whole from the start.
  function renderCoverage() {
    const c = $("coverage");
    if (!flow) { c.textContent = ""; return; }
    const windowLabel = `${days}-day window`;
    if (!flow.data_since) {
      c.textContent = `${windowLabel} · no closed issues recorded yet.`;
    } else if (Date.parse(flow.data_since) > Date.parse(flow.since)) {
      const covered = duration((Date.parse(flow.until) - Date.parse(flow.data_since)) / 1000);
      c.textContent = `${windowLabel}, partly covered: closes recorded since ${when(flow.data_since)} (${covered}).`;
    } else {
      c.textContent = `${windowLabel} · ${when(flow.since)} to ${when(flow.until)}.`;
    }
  }

  // One headline figure: a label, a value, and a line of context.
  function tile(label, value, note) {
    return el("div", { class: "tile" },
      el("dt", {}, label),
      el("dd", { class: value == null ? "value none" : "value" }, value == null ? "—" : value),
      note ? el("dd", { class: "note" }, note) : null);
  }

  function tiles(f, b) {
    const closed = f ? f.completed + f.not_planned + f.duplicate : null;
    const otherwise = f
      ? [f.not_planned > 0 ? `${f.not_planned} not planned` : null, f.duplicate > 0 ? `${plural(f.duplicate, "duplicate", "duplicates")}` : null]
        .filter(Boolean).join(", ")
      : "";
    return el("dl", { class: "tiles" },
      tile("Opened", f ? f.opened : null, null),
      tile("Closed", closed, f ? `${f.completed} completed${otherwise ? `, ${otherwise}` : ""}` : null),
      tile("Time to close", f ? duration(f.close_p50_seconds) : null,
        f && f.close_p90_seconds != null ? `90th pct ${duration(f.close_p90_seconds)}` : "median, of those completed"),
      tile("Open now", b ? b.open : null, b && b.oldest_opened_at ? `oldest opened ${since(b.oldest_opened_at)} ago` : null),
      tile("Stale", b ? b.stale : null, "open, no update for 14 days"));
  }

  // Every UTC day the window touches, oldest first.
  function windowDays(f) {
    const out = [];
    const end = f.until.slice(0, 10);
    for (let t = Date.parse(`${f.since.slice(0, 10)}T00:00:00Z`); ; t += 86_400_000) {
      const day = new Date(t).toISOString().slice(0, 10);
      out.push(day);
      if (day >= end) break;
    }
    return out;
  }

  const SVG = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}, ...children) => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    for (const child of children) {
      if (child == null) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  // One count per day: one series, one axis, bars with rounded data ends, and
  // a hover target per day wider than its bar. Opened and closed are two such
  // charts side by side on the same scale, rather than two series on one.
  function dayChart(repo, daily, key, title, top) {
    const allDays = windowDays(flow);
    const byDay = new Map(daily.map((d) => [d.day, d[key]]));
    const W = 320, H = 120, L = 30, R = 8, T = 10, B = 22;
    const pw = W - L - R, ph = H - T - B, slot = pw / allDays.length;
    const y = (v) => T + ph - (v / top) * ph;
    const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": `${repo}: ${title.toLowerCase()} (UTC)` });
    for (const v of [0, top / 2, top]) {
      chart.append(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "grid" }));
      chart.append(svg("text", { x: L - 6, y: y(v) + 4, class: "tick", "text-anchor": "end" }, v));
    }
    [0, Math.floor((allDays.length - 1) / 2), allDays.length - 1].forEach((i, k) => {
      const anchor = k === 0 ? "start" : k === 2 ? "end" : "middle";
      const x = anchor === "start" ? L : anchor === "end" ? W - R : L + slot * (i + 0.5);
      chart.append(svg("text", { x, y: H - 6, class: "tick", "text-anchor": anchor }, dayLabel(allDays[i])));
    });
    allDays.forEach((day, i) => {
      const v = byDay.get(day) || 0;
      if (v > 0) {
        const w = Math.max(2, Math.min(14, slot - 2)), h = Math.max(2, (v / top) * ph);
        const r = Math.min(3, w / 2, h), x0 = L + slot * (i + 0.5) - w / 2, y0 = T + ph - h;
        chart.append(svg("path", {
          class: "mark",
          d: `M${x0},${T + ph}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${T + ph}Z`,
        }));
      }
      chart.append(svg("rect", { class: "hit", x: L + slot * i, y: T, width: slot, height: ph },
        svg("title", {}, `${dayLabel(day)}: ${v} ${key}`)));
    });
    return el("figure", { class: "trend-chart" }, el("figcaption", {}, `${title} (UTC)`), chart);
  }

  function dayCharts(repo, daily) {
    const most = Math.max(1, ...daily.map((d) => Math.max(d.opened, d.closed)));
    // A round top with a whole midpoint, shared by both charts: 4, 10, 20, 30, …
    const top = most <= 4 ? 4 : most <= 10 ? 10 : Math.ceil(most / 10) * 10;
    const rows = el("tbody");
    for (const d of daily) {
      rows.append(el("tr", {},
        el("th", { scope: "row" }, dayLabel(d.day)),
        el("td", { class: "num" }, d.opened),
        el("td", { class: "num" }, d.closed)));
    }
    return el("div", {},
      el("div", { class: "trend-charts" },
        dayChart(repo, daily, "opened", "Opened per day", top),
        dayChart(repo, daily, "closed", "Closed per day", top)),
      el("details", { class: "trend-table", "data-key": `days-table:${repo}` },
        el("summary", { "data-key": `days-summary:${repo}` }, "Daily figures"),
        el("table", {},
          el("caption", { class: "visually-hidden" }, `${repo}: issues opened and closed per day (UTC)`),
          el("thead", {}, el("tr", {},
            el("th", { scope: "col" }, "Day"),
            el("th", { scope: "col", class: "num" }, "Opened"),
            el("th", { scope: "col", class: "num" }, "Closed"))),
          rows)));
  }

  // Time to close by label, busiest first; beyond `MAX_LABELS` they fold away.
  function labelTable(repo, labels) {
    const row = (l) => el("tr", {},
      el("th", { scope: "row" }, l.label == null ? el("span", { class: "none" }, "No label") : l.label),
      el("td", { class: "num", "data-label": "Completed" }, l.completed),
      el("td", { class: "num", "data-label": "Median" }, duration(l.p50_seconds) || "—"),
      el("td", { class: "num", "data-label": "90th pct" }, duration(l.p90_seconds) || "—"));
    const table = (list, caption) => el("table", { class: "compact" },
      el("caption", { class: "visually-hidden" }, caption),
      el("thead", {}, el("tr", {},
        el("th", { scope: "col" }, "Label"),
        el("th", { scope: "col", class: "num" }, "Completed"),
        el("th", { scope: "col", class: "num" }, "Median"),
        el("th", { scope: "col", class: "num" }, "90th pct"))),
      el("tbody", {}, ...list.map(row)));
    const box = el("div", { class: "slowest" }, el("h3", {}, "Time to close by label"),
      table(labels.slice(0, MAX_LABELS), `${repo}: time to close by label, busiest first`));
    if (labels.length > MAX_LABELS) {
      box.append(el("details", { class: "in-flight", "data-key": `labels:${repo}` },
        el("summary", { "data-key": `labels-summary:${repo}` }, `${plural(labels.length - MAX_LABELS, "more label", "more labels")}`),
        table(labels.slice(MAX_LABELS), `${repo}: time to close for the other labels`)));
    }
    return box;
  }

  // The backlog by age: how long ago each open issue was opened.
  function backlogAges(b) {
    return el("dl", { class: "tiles ages", "aria-label": "Open issues by age" },
      tile("Under a day", b.under_day, null),
      tile("1–7 days", b.under_week, null),
      tile("7–30 days", b.under_month, null),
      tile("Over 30 days", b.older, null));
  }

  function staleTable(repo, issues, total) {
    const body = el("tbody");
    for (const i of issues) {
      body.append(el("tr", {},
        el("td", { class: "pr" },
          el("a", { href: i.url, "data-key": `issue:${repo}#${i.number}` }, `#${i.number}`),
          " ", i.title,
          el("small", {}, i.author)),
        el("td", { "data-label": "Labels" }, i.labels.length > 0
          ? el("span", { class: "labels" }, ...i.labels.map((l) => el("span", { class: "stage" }, l)))
          : el("span", { class: "none" }, "—")),
        el("td", { "data-label": "Quiet for" }, since(i.updated_at)),
        el("td", { "data-label": "Opened" }, `${since(i.opened_at)} ago`)));
    }
    const wrap = el("div", { class: "table-wrap" },
      el("table", {},
        el("caption", { class: "visually-hidden" }, `Stale issues in ${repo}, least recently updated first`),
        el("thead", {}, el("tr", {},
          el("th", { scope: "col" }, "Issue"),
          el("th", { scope: "col" }, "Labels"),
          el("th", { scope: "col" }, "Quiet for"),
          el("th", { scope: "col" }, "Opened"))),
        body));
    const box = el("div", {}, el("h3", {}, total > issues.length
      ? `Stale (${issues.length} least recently updated of ${total})`
      : `Stale (${total})`), wrap);
    return box;
  }

  // A redraw replaces the sections, so keep what the reader is doing: which
  // lists are open, and which control has focus (by data-key).
  function readerState(root) {
    const openDetails = new Set([...root.querySelectorAll("details[open]")].map((d) => d.dataset.key));
    const active = document.activeElement;
    return { openDetails, focused: active && root.contains(active) ? active.dataset.key : null };
  }
  function restoreReaderState(root, { openDetails, focused }) {
    for (const d of root.querySelectorAll("details[data-key]")) if (openDetails.has(d.dataset.key)) d.open = true;
    if (focused) {
      const target = [...root.querySelectorAll("[data-key]")].find((n) => n.dataset.key === focused);
      if (target) target.focus({ preventScroll: true });
    }
  }

  function renderRepos() {
    const root = $("repos");
    const kept = readerState(root);
    root.replaceChildren();
    if (!flow && !open) return;
    const repos = new Map();
    const repo = (name) => {
      if (!repos.has(name)) repos.set(name, { flow: null, labels: [], daily: [], backlog: null, stale: [] });
      return repos.get(name);
    };
    if (flow) {
      for (const f of flow.repos) repo(f.repo).flow = f;
      for (const l of flow.labels) repo(l.repo).labels.push(l);
      for (const d of flow.daily) repo(d.repo).daily.push(d);
    }
    if (open) {
      for (const b of open.backlog) repo(b.repo).backlog = b;
      for (const i of open.stale) repo(i.repo).stale.push(i);
    }
    if (repos.size === 0) {
      root.append(el("p", { class: "empty" }, "No public repository has an open issue, or one opened or closed in this window, yet."));
      return;
    }
    for (const [name, r] of [...repos].sort(([a], [b]) => a.localeCompare(b))) {
      const f = r.flow, b = r.backlog;
      const section = el("section", { class: "repo", "aria-labelledby": `repo-${name}` });
      section.append(el("div", { class: "repo-head" },
        el("h2", { id: `repo-${name}` },
          el("a", { href: `https://github.com/${name}/issues`, "data-key": `link:${name}` }, name), repoMark(name)),
        el("span", { class: "running" }, !b || b.open === 0 ? "Nothing open" : `${b.open} open`)));
      section.append(tiles(f, b));
      const extras = [];
      // Responses are shown only once people outside the org open issues (#48).
      if (f && f.outside_opened > 0) {
        extras.push(`From outside the organisation: ${f.outside_opened} opened, ${f.outside_responded} answered by a maintainer` +
          `${f.response_p50_seconds != null ? ` (median ${duration(f.response_p50_seconds)} to the first reply)` : ""}` +
          `, ${f.outside_waiting} still waiting.`);
      }
      if ((f && f.bots_opened > 0) || (b && b.bots_open > 0)) {
        extras.push(`Bots: ${f ? f.bots_opened : 0} opened in the window, ${b ? b.bots_open : 0} open.`);
      }
      for (const line of extras) section.append(el("p", { class: "aside" }, line));
      if (r.daily.length > 0) section.append(dayCharts(name, r.daily));
      else if (flow) section.append(el("p", { class: "empty" }, "No issues opened or closed in this window."));
      if (r.labels.length > 0) section.append(labelTable(name, r.labels));
      if (b && b.open > 0) {
        section.append(el("h3", {}, "Open by age"));
        section.append(backlogAges(b));
      }
      if (r.stale.length > 0) section.append(staleTable(name, r.stale, b ? b.stale : r.stale.length));
      root.append(section);
    }
    restoreReaderState(root, kept);
  }

  function render() {
    renderFreshness();
    renderCoverage();
    renderRepos();
  }

  // Poll only while the page is visible; catch up at once when it returns.
  let timers = [];
  function poll() {
    timers.forEach(clearInterval);
    timers = live && !signedIn()
      ? [setInterval(refreshFlow, LIVE_POLL_MS), setInterval(refreshOpen, LIVE_POLL_MS)]
      : [setInterval(refreshFlow, FLOW_EVERY_MS), setInterval(refreshOpen, OPEN_EVERY_MS)];
  }
  function start() { refreshAll(); poll(); connect(); }
  function stop() { timers.forEach(clearInterval); timers = []; disconnect(); }

  // The live feed: the server pushes an event when a public issue, pull
  // request, release or run changes. This page acts on issues only, and
  // refetches rather than patching itself, so it always shows the routes' own
  // definitions.
  let socket = null;
  let retryMs = 5_000;
  let retry = null;
  const newClientId = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

  // A live event's refetch. The server says how long to wait (`refetch_ms`):
  // a few seconds when it purged the metrics routes' edge cache for the
  // change, or until any copy cached before it has expired when it couldn't
  // purge (an event without one, from an older server, gets the same). A
  // purge clears every earlier change's stale copies too. Events during a
  // wait never postpone the refetch, so a steady stream still refreshes, and
  // refetches are at least `LIVE_GAP_MS` apart.
  //
  // After a purge, every open page is told the same moment, so each waits a
  // little more at random (`LIVE_JITTER_MS`): the first request at each edge
  // location refills the cache for the rest, rather than all of them missing
  // together. And a purged event is followed by one more refetch once the
  // cache's 30 seconds have passed: a request that read D1 just before the
  // change can refill the cache just after the purge, and that copy is gone
  // by then.
  const LIVE_DELAY_MS = CACHE_MS + 1_000;
  const PURGED_MAX_MS = 5_000;
  const LIVE_GAP_MS = 10_000;
  const LIVE_JITTER_MS = 4_000;
  let liveTimer = null;
  let timerDue = 0;
  let latestDue = 0;
  let lastRefetch = 0;
  function onLiveEvent(refetchMs, refetch) {
    const now = Date.now();
    const wait = Number.isFinite(refetchMs) && refetchMs > 0 ? refetchMs : LIVE_DELAY_MS;
    const purged = wait <= PURGED_MAX_MS;
    const due = now + wait + (purged ? Math.random() * LIVE_JITTER_MS : 0);
    // A purge covers every earlier change; its follow-up covers the purge.
    latestDue = purged ? now + LIVE_DELAY_MS : Math.max(latestDue, due);
    scheduleLive(due, refetch);
  }
  function scheduleLive(due, refetch) {
    const at = Math.max(due, lastRefetch + LIVE_GAP_MS);
    if (liveTimer && timerDue <= at) return;
    clearTimeout(liveTimer);
    timerDue = at;
    liveTimer = setTimeout(() => fireLive(refetch), Math.max(0, at - Date.now()));
  }
  function fireLive(refetch) {
    liveTimer = null;
    lastRefetch = Date.now();
    refetch();
    if (latestDue > lastRefetch) scheduleLive(latestDue, refetch);
    else latestDue = 0;
  }

  function connect() {
    if (socket || !("WebSocket" in globalThis)) return;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/live?board=ci&client=${newClientId()}`);
    socket = ws;
    ws.onopen = () => { live = true; retryMs = 5_000; poll(); renderFreshness(); };
    ws.onmessage = (m) => {
      let e = null;
      try {
        e = JSON.parse(m.data);
      } catch {
        // unreadable: refresh anyway, after the longest wait
      }
      if (e && e.kind !== "issue") return;
      onLiveEvent(e ? e.refetch_ms : undefined, refreshAll);
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      const wasLive = live;
      live = false;
      if (wasLive) poll();
      renderFreshness();
      if (!document.hidden) {
        retry = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 60_000);
      }
    };
  }
  function disconnect() {
    clearTimeout(retry);
    clearTimeout(liveTimer);
    liveTimer = null;
    const ws = socket;
    socket = null;
    live = false;
    if (ws) ws.close();
  }

  // Signed in, the repository marks arrive after the first figures; signed
  // out (a refused token), they go. Redraw either way.
  document.addEventListener("bynk:repositories", () => render());

  document.addEventListener("DOMContentLoaded", () => {
    for (const input of document.querySelectorAll('input[name="days"]')) {
      input.addEventListener("change", () => {
        days = Number(input.value);
        flow = null;
        refreshFlow();
      });
    }
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    start();
  });
})();
