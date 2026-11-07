// Releases page (#36): reads the public releases routes and redraws.
// Everything that came from GitHub (repository names, tags, release names) is
// set with textContent, never as markup.
(() => {
  "use strict";

  const RECENT_EVERY_MS = 60_000;   // releases are rare; polling is a safety net
  const FLOW_EVERY_MS = 60_000;
  const LIVE_POLL_MS = 120_000;     // while the live feed is up
  const CACHE_MS = 30_000;          // the routes' `max-age` at the edge
  const SHOWN_RELEASES = 10;        // the rest of each repository's 20 are folded away
  let days = 7;
  let flow = null;
  let recent = null;
  const fresh = { flow: { lastOk: null, failing: false }, recent: { lastOk: null, failing: false } };
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
      const f = await figures("/metrics/releases", { days: asked });
      if (asked !== days) return; // the window changed while this was in flight
      flow = f;
      ok("flow");
    } catch (e) {
      if (asked !== days) return;
      failed("flow", e);
    }
    render();
  }

  async function refreshRecent() {
    try {
      recent = await figures("/metrics/releases/recent");
      ok("recent");
    } catch (e) {
      failed("recent", e);
    }
    render();
  }

  const refreshAll = () => { refreshFlow(); refreshRecent(); };
  const ok = (source) => { fresh[source] = { lastOk: new Date(), failing: false }; };
  function failed(source, e) {
    fresh[source].failing = true;
    console.warn(`Releases: refreshing ${source} failed:`, e.message);
  }

  function renderFreshness() {
    const f = $("freshness");
    const describe = (source, label) => {
      const s = fresh[source];
      if (!s.lastOk) return s.failing ? `${label}: couldn't load, retrying` : null;
      return s.failing ? `${label} from ${clock(s.lastOk)} UTC, retrying` : null;
    };
    const problems = [describe("recent", "Recent releases"), describe("flow", "Window figures")].filter(Boolean);
    const latest = [fresh.recent.lastOk, fresh.flow.lastOk].filter(Boolean).sort((a, b) => b - a)[0];
    if (problems.length > 0) f.textContent = `${problems.join("; ")}.`;
    else if (latest) {
      f.textContent = live
        ? `${signedIn() ? "Public repositories live, private and not-public ones polled" : "Live"} · updated ${clock(latest)} UTC as releases and merges happen`
        : `Updated ${clock(latest)} UTC · refreshes every minute`;
    } else f.textContent = "Loading…";
    f.classList.toggle("stale", problems.length > 0);
  }

  function renderCoverage() {
    const c = $("coverage");
    c.textContent = flow ? `${days}-day window · ${when(flow.since)} to ${when(flow.until)}.` : "";
  }

  // One headline figure: a label, a value, and a line of context.
  function tile(label, value, note) {
    return el("div", { class: "tile" },
      el("dt", {}, label),
      el("dd", { class: value == null ? "value none" : "value" }, value == null ? "—" : value),
      note ? el("dd", { class: "note" }, note) : null);
  }

  function tiles(f, pipeline) {
    const p95 = (s) => (s == null ? null : `95th pct ${duration(s)}`);
    const recorded = f.recording_since && flow && Date.parse(f.recording_since) > Date.parse(flow.since)
      ? `pull requests recorded since ${when(f.recording_since)}`
      : null;
    const cadence = [
      f.prereleases > 0 ? plural(f.prereleases, "pre-release", "pre-releases") : null,
      f.interval_p50_seconds != null ? `median ${duration(f.interval_p50_seconds)} apart` : null,
    ].filter(Boolean).join(" · ") || null;
    const ship = f.shipped_counted > 0
      ? [p95(f.merge_to_release_p95_seconds), `over ${plural(f.shipped_counted, "pull request", "pull requests")}`, recorded]
      : [f.recording_since ? recorded : "pull requests not recorded yet"];
    const runs = pipeline.reduce((n, p) => n + p.runs, 0);
    const failedRuns = pipeline.reduce((n, p) => n + p.failed, 0);
    const median = pipeline.length === 1 ? pipeline[0].p50_seconds : null;
    return el("dl", { class: "tiles" },
      tile("Releases", f.releases, cadence),
      tile("Since the last", since(f.last_at), `${f.last_tag}, ${when(f.last_at)}`),
      tile("Merge to release", duration(f.merge_to_release_p50_seconds), ship.filter(Boolean).join(" · ") || null),
      tile("Waiting to ship", f.waiting,
        f.waiting_since ? `merged since ${f.last_tag}; the oldest ${since(f.waiting_since)} ago` : `merged since ${f.last_tag}`),
      tile("Release workflow", runs === 0 ? null : median != null ? duration(median) : plural(runs, "run", "runs"),
        runs === 0
          ? "no runs on tags in this window"
          : [median != null ? `median of ${plural(runs, "run", "runs")}` : null,
             failedRuns > 0 ? `${failedRuns} failed` : "none failed"].filter(Boolean).join(" · ")));
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

  // Pull requests by people that each recent final release shipped, oldest on
  // the left: one series, one axis, bars with rounded data ends, and a hover
  // target per release wider than its bar. A release whose count isn't known
  // has no bar, and says so on hover; the table lists the same.
  function shippedChart(repo, finals) {
    const known = finals.map((r) => r.shipped_by_people).filter((v) => v != null);
    const most = Math.max(1, ...known);
    const top = most <= 4 ? 4 : most <= 10 ? 10 : Math.ceil(most / 10) * 10;
    const W = 320, H = 120, L = 30, R = 8, T = 10, B = 22;
    const pw = W - L - R, ph = H - T - B, slot = pw / finals.length;
    const y = (v) => T + ph - (v / top) * ph;
    const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": `${repo}: pull requests by people shipped by each recent release` });
    for (const v of [0, top / 2, top]) {
      chart.append(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "grid" }));
      chart.append(svg("text", { x: L - 6, y: y(v) + 4, class: "tick", "text-anchor": "end" }, v));
    }
    const labels = finals.length === 1 ? [[0, "middle"]] : [[0, "start"], [finals.length - 1, "end"]];
    for (const [i, anchor] of labels) {
      const x = anchor === "start" ? L : anchor === "end" ? W - R : L + slot * (i + 0.5);
      chart.append(svg("text", { x, y: H - 6, class: "tick", "text-anchor": anchor }, finals[i].tag));
    }
    finals.forEach((r, i) => {
      const v = r.shipped_by_people;
      if (v != null && v > 0) {
        const w = Math.max(2, Math.min(14, slot - 2)), h = Math.max(2, (v / top) * ph);
        const rr = Math.min(3, w / 2, h), x0 = L + slot * (i + 0.5) - w / 2, y0 = T + ph - h;
        chart.append(svg("path", {
          class: "mark",
          d: `M${x0},${T + ph}V${y0 + rr}Q${x0},${y0} ${x0 + rr},${y0}H${x0 + w - rr}Q${x0 + w},${y0} ${x0 + w},${y0 + rr}V${T + ph}Z`,
        }));
      }
      chart.append(svg("rect", { class: "hit", x: L + slot * i, y: T, width: slot, height: ph },
        svg("title", {}, `${r.tag}: ${v == null ? "not known" : plural(v, "pull request", "pull requests")}`)));
    });
    return el("figure", { class: "trend-chart flow-chart" },
      el("figcaption", {}, "Pull requests by people shipped, per release (no bar: not known)"), chart);
  }

  function shippedCell(r) {
    if (r.prerelease) return el("span", { class: "none" }, "—");
    if (r.shipped == null) {
      return el("span", { class: "none", title: r.previous_tag ? "Not known: some of what it shipped wasn't recorded" : "Not known" }, "not known");
    }
    const bots = r.shipped - (r.shipped_by_people ?? r.shipped);
    return el("span", {}, `${r.shipped_by_people ?? r.shipped}`, bots > 0 ? el("small", {}, ` + ${bots} by bots`) : null);
  }

  function releasesTable(repo, releases, which) {
    const body = el("tbody");
    for (const r of releases) {
      body.append(el("tr", {},
        el("td", { class: "pr" },
          el("a", { href: r.url, "data-key": `release:${repo}@${r.tag}` }, r.tag),
          r.prerelease ? el("span", { class: "stage draft" }, "Pre-release") : null,
          r.name && r.name !== r.tag ? el("small", {}, r.name) : null),
        el("td", { "data-label": "Published" }, when(r.published_at)),
        el("td", { "data-label": "Pull requests", class: "num" }, shippedCell(r)),
        el("td", { "data-label": "After" }, r.previous_tag ? r.previous_tag : el("span", { class: "none" }, "—"))));
    }
    return el("div", { class: "table-wrap" },
      el("table", {},
        el("caption", { class: "visually-hidden" }, `${which === "latest" ? "Latest" : "Earlier"} releases of ${repo}, newest first`),
        el("thead", {}, el("tr", {},
          el("th", { scope: "col" }, "Release"),
          el("th", { scope: "col" }, "Published"),
          el("th", { scope: "col", class: "num" }, "Pull requests by people"),
          el("th", { scope: "col" }, "After"))),
        body));
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
    if (!flow && !recent) return;
    const repos = new Map();
    const repo = (name) => {
      if (!repos.has(name)) repos.set(name, { flow: null, pipeline: [], recent: [] });
      return repos.get(name);
    };
    if (flow) {
      for (const f of flow.repos) repo(f.repo).flow = f;
      for (const p of flow.pipeline) repo(p.repo).pipeline.push(p);
    }
    for (const r of recent ? recent.releases : []) repo(r.repo).recent.push(r);
    if (repos.size === 0) {
      root.append(el("p", { class: "empty" }, "No public repository has published a release yet."));
      return;
    }
    for (const [name, r] of [...repos].sort(([a], [b]) => a.localeCompare(b))) {
      const section = el("section", { class: "repo", "aria-labelledby": `repo-${name}` });
      section.append(el("div", { class: "repo-head" },
        el("h2", { id: `repo-${name}` },
          el("a", { href: `https://github.com/${name}/releases`, "data-key": `link:${name}` }, name), repoMark(name)),
        el("span", { class: "running" }, r.flow
          ? `Latest ${r.flow.last_tag}, ${since(r.flow.last_at)} ago`
          : "No final release yet")));
      if (r.flow) section.append(tiles(r.flow, r.pipeline));
      // The chart only once a count is known: bars all missing say nothing.
      const finals = r.recent.filter((x) => !x.prerelease).reverse();
      if (finals.length > 1 && finals.some((x) => x.shipped_by_people != null)) {
        section.append(shippedChart(name, finals));
      }
      if (r.recent.length > 0) {
        section.append(el("h3", {}, "Recent releases"));
        section.append(releasesTable(name, r.recent.slice(0, SHOWN_RELEASES), "latest"));
        const earlier = r.recent.slice(SHOWN_RELEASES);
        if (earlier.length > 0) {
          section.append(el("details", { class: "trend-table", "data-key": `earlier:${name}` },
            el("summary", { "data-key": `earlier-summary:${name}` }, plural(earlier.length, "earlier release", "earlier releases")),
            releasesTable(name, earlier, "earlier")));
        }
      }
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
      ? [setInterval(refreshFlow, LIVE_POLL_MS), setInterval(refreshRecent, LIVE_POLL_MS)]
      : [setInterval(refreshFlow, FLOW_EVERY_MS), setInterval(refreshRecent, RECENT_EVERY_MS)];
  }
  function start() { refreshAll(); poll(); connect(); }
  function stop() { timers.forEach(clearInterval); timers = []; disconnect(); }

  // The live feed: the server pushes an event when a public release, pull
  // request or run changes. This page acts on releases, and on pull requests
  // merging (what is waiting to ship changes), and refetches rather than
  // patching itself, so it always shows the routes' own definitions. The
  // timing is the PR page's: see there.
  let socket = null;
  let retryMs = 5_000;
  let retry = null;
  const newClientId = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

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

  // Whether an event can change this page: a release, or a pull request
  // merging.
  const concerns = (e) => e.kind === "release" || (e.kind === "pull" && e.conclusion === "merged");

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
      if (e && !concerns(e)) return;
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
