// PR flow page (#26): reads the public PR routes and redraws. Everything that
// came from GitHub (repository names, titles, authors) is set with
// textContent, never as markup.
(() => {
  "use strict";

  const OPEN_EVERY_MS = 30_000;     // what is open, and where each one is
  const FLOW_EVERY_MS = 60_000;     // the window's figures move more slowly
  const LIVE_POLL_MS = 120_000;     // while the live feed is up, polling is only a safety net
  const LIVE_SETTLE_MS = 3_000;     // the shortest wait between two live refetches
  const CACHE_MS = 30_000;          // the routes' `max-age`, at the edge and in the browser
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
  // GitHub's reasons for leaving the merge queue, in words; any other is shown
  // as GitHub spells it, lower case.
  const REASONS = {
    CI_FAILURE: "CI failed", CI_TIMEOUT: "CI timed out", MERGE_CONFLICT: "merge conflict",
    MANUAL: "removed by hand", ALREADY_MERGED: "already merged", BRANCH_PROTECTIONS: "branch protection",
    GIT_TREE_INVALID: "invalid Git tree", INVALID_MERGE_COMMIT: "invalid merge commit",
    QUEUE_CLEARED: "queue cleared", ROLL_BACK: "rolled back", unknown: "no reason given",
  };
  const reasonLabel = (r) => REASONS[r] || r.toLowerCase().replace(/_/g, " ");

  async function getJson(path) {
    const res = await fetch(path, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(res.status === 429 ? "rate limited" : `HTTP ${res.status}`);
    return res.json();
  }

  async function refreshFlow() {
    const asked = days;
    try {
      const f = await getJson(`/metrics/prs?days=${asked}`);
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
      open = await getJson("/metrics/prs/open");
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
    console.warn(`PR flow: refreshing ${source} failed:`, e.message);
  }

  function renderFreshness() {
    const f = $("freshness");
    const describe = (source, label) => {
      const s = fresh[source];
      if (!s.lastOk) return s.failing ? `${label}: couldn't load, retrying` : null;
      return s.failing ? `${label} from ${clock(s.lastOk)} UTC, retrying` : null;
    };
    const problems = [describe("open", "Open pull requests"), describe("flow", "Window figures")].filter(Boolean);
    const latest = [fresh.open.lastOk, fresh.flow.lastOk].filter(Boolean).sort((a, b) => b - a)[0];
    if (problems.length > 0) f.textContent = `${problems.join("; ")}.`;
    else if (latest) {
      f.textContent = live
        ? `Live · updated ${clock(latest)} UTC as pull requests change`
        : `Updated ${clock(latest)} UTC · refreshes every 30 seconds`;
    } else f.textContent = "Loading…";
    f.classList.toggle("stale", problems.length > 0);
  }

  function renderCoverage() {
    const c = $("coverage");
    if (!flow) { c.textContent = ""; return; }
    const windowLabel = `${days}-day window`;
    if (!flow.data_since) {
      c.textContent = `${windowLabel} · no merged pull requests recorded yet.`;
    } else if (Date.parse(flow.data_since) > Date.parse(flow.since)) {
      const covered = duration((Date.parse(flow.until) - Date.parse(flow.data_since)) / 1000);
      c.textContent = `${windowLabel}, partly covered: merges recorded since ${when(flow.data_since)} (${covered}).`;
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

  function tiles(f) {
    const p95 = (s) => (s == null ? null : `95th pct ${duration(s)}`);
    const counted = f.ready_to_merge_counted < f.merged
      ? `over ${f.ready_to_merge_counted} of ${f.merged}; the rest became ready before recording began`
      : null;
    return el("dl", { class: "tiles" },
      tile("Merged", f.merged, f.closed_unmerged > 0 ? `${f.closed_unmerged} closed without merging` : null),
      tile("Ready to merge", duration(f.ready_to_merge_p50_seconds),
        [p95(f.ready_to_merge_p95_seconds), counted].filter(Boolean).join(" · ") || null),
      tile("Opened to merge", duration(f.open_to_merge_p50_seconds), p95(f.open_to_merge_p95_seconds)),
      tile("In the merge queue", duration(f.queue_p50_seconds),
        [p95(f.queue_p95_seconds), f.requeued > 0 ? `${plural(f.requeued, "pull request", "pull requests")} queued more than once` : null]
          .filter(Boolean).join(" · ") || null),
      tile("Size", f.size_p50_lines == null ? null : `${f.size_p50_lines} lines`, "median lines added and removed"));
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

  // Merges per day: one series, one axis, bars with rounded data ends, and a
  // hover target per day wider than its bar.
  function mergedChart(repo, daily) {
    const allDays = windowDays(flow);
    const byDay = new Map(daily.map((d) => [d.day, d.merged]));
    const most = Math.max(1, ...daily.map((d) => d.merged));
    // A round top with a whole midpoint: 4, 10, 20, 30, …
    const top = most <= 4 ? 4 : most <= 10 ? 10 : Math.ceil(most / 10) * 10;
    const W = 320, H = 120, L = 30, R = 8, T = 10, B = 22;
    const pw = W - L - R, ph = H - T - B, slot = pw / allDays.length;
    const y = (v) => T + ph - (v / top) * ph;
    const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": `${repo}: pull requests merged per day (UTC)` });
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
        svg("title", {}, `${dayLabel(day)}: ${plural(v, "merged", "merged")}`)));
    });
    const rows = el("tbody");
    for (const d of daily) rows.append(el("tr", {}, el("th", { scope: "row" }, dayLabel(d.day)), el("td", { class: "num" }, d.merged)));
    return el("div", { class: "flow-chart" },
      el("figure", { class: "trend-chart" }, el("figcaption", {}, "Merged per day (UTC)"), chart),
      el("details", { class: "trend-table", "data-key": `merged-table:${repo}` },
        el("summary", { "data-key": `merged-summary:${repo}` }, "Daily figures"),
        el("table", {},
          el("caption", { class: "visually-hidden" }, `${repo}: merged per day (UTC)`),
          el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Day"), el("th", { scope: "col", class: "num" }, "Merged"))),
          rows)));
  }

  function stageCell(p) {
    const label = { draft: "Draft", queued: "In the queue", ready: "Ready" }[p.stage] || p.stage;
    return el("span", { class: `stage ${p.stage}` }, label);
  }

  function openTable(repo, pulls) {
    const body = el("tbody");
    for (const p of pulls) {
      const waiting = p.stage === "draft"
        ? `opened ${since(p.opened_at)} ago`
        : p.ready_since ? `ready for ${since(p.ready_since)}` : `opened ${since(p.opened_at)} ago`;
      body.append(el("tr", {},
        el("td", { class: "pr" },
          el("a", { href: `https://github.com/${repo}/pull/${p.number}`, "data-key": `pr:${repo}#${p.number}` }, `#${p.number}`),
          " ", p.title,
          el("small", {}, p.author, p.author_is_bot ? " · bot" : "")),
        el("td", { "data-label": "Stage" }, stageCell(p)),
        el("td", { "data-label": "Waiting" }, waiting),
        el("td", { "data-label": "Flag" }, p.stale
          ? el("span", { class: "flag stale-flag", title: "Ready for more than 7 days and not in the queue" },
              el("span", { class: "icon", "aria-hidden": "true" }, "!"), "Stale")
          : el("span", { class: "none" }, "—"))));
    }
    return el("div", { class: "table-wrap" },
      el("table", {},
        el("caption", { class: "visually-hidden" }, `Open pull requests in ${repo}, longest waiting first, then drafts`),
        el("thead", {}, el("tr", {},
          el("th", { scope: "col" }, "Pull request"),
          el("th", { scope: "col" }, "Stage"),
          el("th", { scope: "col" }, "Waiting"),
          el("th", { scope: "col" }, ""))),
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
    if (!flow && !open) return;
    const repos = new Map();
    const repo = (name) => {
      if (!repos.has(name)) repos.set(name, { flow: null, exits: [], daily: [], open: [] });
      return repos.get(name);
    };
    if (flow) {
      for (const f of flow.repos) repo(f.repo).flow = f;
      for (const x of flow.queue_exits) repo(x.repo).exits.push(x);
      for (const d of flow.daily) repo(d.repo).daily.push(d);
    }
    for (const p of open ? open.open : []) repo(p.repo).open.push(p);
    if (repos.size === 0) {
      root.append(el("p", { class: "empty" }, "No public repository has a merged or open pull request in this window yet."));
      return;
    }
    for (const [name, r] of [...repos].sort(([a], [b]) => a.localeCompare(b))) {
      const bots = r.open.filter((p) => p.author_is_bot).length;
      const section = el("section", { class: "repo", "aria-labelledby": `repo-${name}` });
      section.append(el("div", { class: "repo-head" },
        el("h2", { id: `repo-${name}` },
          el("a", { href: `https://github.com/${name}/pulls`, "data-key": `link:${name}` }, name)),
        el("span", { class: "running" }, r.open.length === 0
          ? "Nothing open"
          : `${r.open.length} open${bots > 0 ? ` (${bots} by ${bots === 1 ? "a bot" : "bots"})` : ""}`)));
      if (r.flow) {
        section.append(tiles(r.flow));
        const extras = [];
        if (r.exits.length > 0) {
          extras.push(`Left the merge queue without merging: ${r.exits.map((x) => `${reasonLabel(x.reason)} (${x.count})`).join(", ")}.`);
        }
        if (r.flow.bots_merged > 0 || r.flow.bots_open > 0) {
          extras.push(`Bots: ${r.flow.bots_merged} merged${r.flow.bots_merge_p50_seconds != null ? ` (median ${duration(r.flow.bots_merge_p50_seconds)})` : ""}, ${r.flow.bots_open} open.`);
        }
        for (const line of extras) section.append(el("p", { class: "aside" }, line));
        if (r.daily.length > 0) section.append(mergedChart(name, r.daily));
      } else {
        section.append(el("p", { class: "empty" }, "No pull requests merged or closed in this window."));
      }
      if (r.open.length > 0) {
        section.append(el("h3", {}, "Open now"));
        section.append(openTable(name, r.open));
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
    timers = live
      ? [setInterval(refreshFlow, LIVE_POLL_MS), setInterval(refreshOpen, LIVE_POLL_MS)]
      : [setInterval(refreshFlow, FLOW_EVERY_MS), setInterval(refreshOpen, OPEN_EVERY_MS)];
  }
  function start() { refreshAll(); poll(); connect(); }
  function stop() { timers.forEach(clearInterval); timers = []; disconnect(); }

  // The live feed: the server pushes an event when a public pull request or
  // run changes. This page acts on pull requests only, and refetches rather
  // than patching itself, so it always shows the routes' own definitions.
  let socket = null;
  let retryMs = 5_000;
  let retry = null;
  const newClientId = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

  // A live event's refetch. Responses are cached 30 seconds at the edge,
  // keyed by URL and shared by every viewer, so any copy made before the event
  // (by this page or another) may be served until 30 seconds after it: the
  // refetch goes 31 seconds after the event. Events during the wait don't
  // postpone it, so a steady stream still refreshes; one more refetch follows
  // 31 seconds after the latest of them.
  const LIVE_DELAY_MS = CACHE_MS + 1_000;
  let liveTimer = null;
  let lastEventAt = 0;
  let timerFor = 0;
  function onLiveEvent(refetch) {
    lastEventAt = Date.now();
    if (liveTimer) return;
    timerFor = lastEventAt;
    liveTimer = setTimeout(() => fireLive(refetch), LIVE_DELAY_MS);
  }
  function fireLive(refetch) {
    liveTimer = null;
    refetch();
    if (lastEventAt > timerFor) {
      timerFor = lastEventAt;
      liveTimer = setTimeout(() => fireLive(refetch), Math.max(LIVE_SETTLE_MS, lastEventAt + LIVE_DELAY_MS - Date.now()));
    }
  }

  function connect() {
    if (socket || !("WebSocket" in globalThis)) return;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/live?board=ci&client=${newClientId()}`);
    socket = ws;
    ws.onopen = () => { live = true; retryMs = 5_000; poll(); renderFreshness(); };
    ws.onmessage = (m) => {
      try {
        if (JSON.parse(m.data).kind !== "pull") return;
      } catch {
        // unreadable: refresh anyway
      }
      onLiveEvent(refreshAll);
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
