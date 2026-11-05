// CI health page (#20): reads the public metrics routes and redraws.
// Everything that came from GitHub (repository, workflow and branch names) is
// set with textContent, never as markup.
(() => {
  "use strict";

  const NOW_EVERY_MS = 30_000;      // what is running, and the default-branch state
  const METRICS_EVERY_MS = 60_000;  // the window's figures move more slowly
  const LIVE_POLL_MS = 120_000;     // while the live feed is up, polling is only a safety net
  const LIVE_SETTLE_MS = 3_000;     // a burst of runs costs one refresh, not one each
  let days = 7;
  let metrics = null;
  let now = null;
  // Each source keeps its own freshness, so one succeeding never hides the
  // other failing.
  const fresh = { metrics: { lastOk: null, failing: false }, now: { lastOk: null, failing: false } };
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

  async function getJson(path) {
    const res = await fetch(path, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(res.status === 429 ? "rate limited" : `HTTP ${res.status}`);
    return res.json();
  }

  async function refreshMetrics() {
    const asked = days;
    try {
      const m = await getJson(`/metrics/ci?days=${asked}`);
      if (asked !== days) return; // the window changed while this was in flight
      metrics = m;
      ok("metrics");
    } catch (e) {
      if (asked !== days) return;
      failed("metrics", e);
    }
    render();
  }

  async function refreshNow() {
    try {
      now = await getJson("/metrics/ci/now");
      ok("now");
    } catch (e) {
      failed("now", e);
    }
    render();
  }

  function ok(source) {
    fresh[source] = { lastOk: new Date(), failing: false };
  }

  function failed(source, e) {
    fresh[source].failing = true;
    console.warn(`CI health: refreshing ${source} failed:`, e.message);
  }

  const clock = (d) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });

  function renderFreshness() {
    const f = $("freshness");
    const describe = (source, label) => {
      const s = fresh[source];
      if (!s.lastOk) return s.failing ? `${label}: couldn't load, retrying` : null;
      return s.failing ? `${label} from ${clock(s.lastOk)} UTC, retrying` : null;
    };
    const problems = [describe("now", "Running and default-branch states"), describe("metrics", "Window figures")]
      .filter(Boolean);
    const latest = [fresh.now.lastOk, fresh.metrics.lastOk].filter(Boolean).sort((a, b) => b - a)[0];
    if (problems.length > 0) {
      f.textContent = `${problems.join("; ")}.`;
    } else if (latest) {
      f.textContent = live
        ? `Live · updated ${clock(latest)} UTC as runs change`
        : `Updated ${clock(latest)} UTC · refreshes every 30 seconds`;
    } else {
      f.textContent = "Loading…";
    }
    f.classList.toggle("stale", problems.length > 0);
  }

  function renderCoverage() {
    const c = $("coverage");
    if (!metrics) { c.textContent = ""; return; }
    const windowLabel = `${days}-day window`;
    if (!metrics.data_since) {
      c.textContent = `${windowLabel} · no completed runs recorded yet.`;
      return;
    }
    if (Date.parse(metrics.data_since) > Date.parse(metrics.since)) {
      const covered = duration((Date.parse(metrics.until) - Date.parse(metrics.data_since)) / 1000);
      c.textContent = `${windowLabel}, partly covered: data since ${when(metrics.data_since)} (${covered}).`;
    } else {
      c.textContent = `${windowLabel} · ${when(metrics.since)} to ${when(metrics.until)}.`;
    }
  }

  function stateCell(state) {
    if (!state) {
      return el("span", { class: "state none", title: "No push to the default branch in the last 90 days" }, "Not run on pushes");
    }
    if (state.conclusion === "success") {
      return el("span", { class: "state good" },
        el("span", { class: "icon", "aria-hidden": "true" }, "✓"),
        `Passing on ${state.branch}`);
    }
    const label = state.conclusion === "timed_out" ? "Timed out" : "Failing";
    return el("span", { class: "state critical", title: `Red since ${when(state.red_since || state.completed_at)}` },
      el("span", { class: "icon", "aria-hidden": "true" }, "✕"),
      `${label} on ${state.branch} for ${since(state.red_since || state.completed_at)}`);
  }

  function conclusionsBar(w) {
    const parts = [
      ["passed", w.success, "passed"],
      ["failed", w.failure + w.timed_out, "failed or timed out"],
      ["other", w.cancelled + w.skipped + w.other, "not counted"],
    ];
    const label = parts.map(([, n, name]) => `${n} ${name}`).join(", ");
    const bar = el("div", { class: "bar", role: "img", "aria-label": label, title: label });
    for (const [cls, n] of parts) {
      if (n > 0) {
        const seg = el("span", { class: `seg ${cls}` });
        seg.style.flexGrow = String(n);
        bar.append(seg);
      }
    }
    return bar;
  }

  function cell(label, value, cls = "num") {
    return value == null
      ? el("td", { class: `${cls} none`, "data-label": label }, "—")
      : el("td", { class: cls, "data-label": label }, value);
  }

  // A redraw replaces the sections, so keep what the reader is doing: which
  // "Running now" lists are open, and which control has focus (by data-key).
  function readerState(root) {
    const open = new Set([...root.querySelectorAll("details[open]")].map((d) => d.dataset.key));
    const active = document.activeElement;
    const focused = active && root.contains(active) ? active.dataset.key : null;
    return { open, focused };
  }

  function restoreReaderState(root, { open, focused }) {
    for (const d of root.querySelectorAll("details[data-key]")) if (open.has(d.dataset.key)) d.open = true;
    if (focused) {
      const target = [...root.querySelectorAll("[data-key]")].find((n) => n.dataset.key === focused);
      if (target) target.focus({ preventScroll: true });
    }
  }

  function renderRepos() {
    const root = $("repos");
    const kept = readerState(root);
    root.replaceChildren();
    if (!metrics && !now) return;
    const repos = new Map();
    const repo = (name) => {
      if (!repos.has(name)) repos.set(name, { workflows: new Map(), running: [] });
      return repos.get(name);
    };
    for (const w of metrics ? metrics.workflows : []) repo(w.repo).workflows.set(w.path, { health: w });
    for (const s of now ? now.main : []) {
      const r = repo(s.repo);
      const entry = r.workflows.get(s.path) || { health: null };
      entry.state = s;
      r.workflows.set(s.path, entry);
    }
    for (const f of now ? now.in_flight : []) repo(f.repo).running.push(f);

    if (repos.size === 0) {
      root.append(el("p", { class: "empty" }, "No public repository has a completed run in this window yet."));
      return;
    }

    for (const [name, r] of [...repos].sort(([a], [b]) => a.localeCompare(b))) {
      const section = el("section", { class: "repo", "aria-labelledby": `repo-${name}` });
      const running = r.running.length;
      section.append(el("div", { class: "repo-head" },
        el("h2", { id: `repo-${name}` },
          el("a", { href: `https://github.com/${name}/actions`, "data-key": `link:${name}` }, name)),
        el("span", { class: "running" }, running === 0 ? "Nothing running" : `${running} running`)));

      const table = el("table", {},
        el("caption", { class: "visually-hidden" }, `CI health for ${name}, ${days}-day window`),
        el("thead", {}, el("tr", {},
          el("th", { scope: "col" }, "Workflow"),
          el("th", { scope: "col" }, "Default branch"),
          el("th", { scope: "col", class: "num" }, "Pass rate"),
          el("th", { scope: "col", class: "num" }, "Runs"),
          el("th", { scope: "col", class: "num" }, "Median time"),
          el("th", { scope: "col", class: "num" }, "95th pct time"),
          el("th", { scope: "col", class: "num" }, "Flaky"),
          el("th", { scope: "col" }, "Conclusions"))));
      const body = el("tbody");
      const rows = [...r.workflows].sort(([, a], [, b]) => {
        const an = (a.health && a.health.workflow) || (a.state && a.state.workflow) || "";
        const bn = (b.health && b.health.workflow) || (b.state && b.state.workflow) || "";
        return an.localeCompare(bn);
      });
      for (const [path, { health: h, state }] of rows) {
        const nameText = (h && h.workflow) || (state && state.workflow) || path;
        body.append(el("tr", {},
          el("td", { class: "workflow" }, nameText, el("small", {}, path)),
          el("td", { class: "state-cell", "data-label": "Default branch" }, stateCell(state)),
          cell("Pass rate", h && h.pass_percent != null ? `${h.pass_percent}%` : null),
          cell("Runs", h ? h.runs : null),
          cell("Median time", h ? duration(h.wall_p50_seconds) : null),
          cell("95th pct time", h ? duration(h.wall_p95_seconds) : null),
          cell("Flaky", h ? h.flaky : null),
          h
            ? el("td", { class: "bar-cell", "data-label": "Conclusions" }, conclusionsBar(h))
            : el("td", { class: "bar-cell none", "data-label": "Conclusions" }, "No runs in this window")));
      }
      table.append(body);
      section.append(el("div", { class: "table-wrap" }, table));

      if (running > 0) {
        const list = el("ul");
        for (const f of r.running) {
          list.append(el("li", {},
            `${f.workflow} · ${f.event}${f.branch ? ` on ${f.branch}` : ""} · ${f.status.replace("_", " ")}, queued ${since(f.queued_at)} ago`));
        }
        section.append(el("details", { class: "in-flight", "data-key": `running:${name}` },
          el("summary", { "data-key": `summary:${name}` }, `Running now (${running})`), list));
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
  // While the live feed is connected, polling slows to a safety net.
  let timers = [];
  function poll() {
    timers.forEach(clearInterval);
    timers = live
      ? [setInterval(refreshMetrics, LIVE_POLL_MS), setInterval(refreshNow, LIVE_POLL_MS)]
      : [setInterval(refreshMetrics, METRICS_EVERY_MS), setInterval(refreshNow, NOW_EVERY_MS)];
  }
  function start() {
    refreshMetrics();
    refreshNow();
    poll();
    connect();
  }
  function stop() {
    timers.forEach(clearInterval);
    timers = [];
    disconnect();
  }

  // The live feed: the server pushes an event whenever a public run changes.
  // The page refetches rather than patching itself, so it always shows the
  // routes' own definitions. Reconnects with backoff, falling back to polling.
  let socket = null;
  let settle = null;
  let retryMs = 5_000;
  let retry = null;
  const client = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

  function connect() {
    if (socket || !("WebSocket" in globalThis)) return;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/live?board=ci&client=${client}`);
    socket = ws;
    ws.onopen = () => {
      live = true;
      retryMs = 5_000;
      poll();
      renderFreshness();
    };
    ws.onmessage = () => {
      clearTimeout(settle);
      settle = setTimeout(() => { refreshNow(); refreshMetrics(); }, LIVE_SETTLE_MS);
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
    clearTimeout(settle);
    const ws = socket;
    socket = null;
    live = false;
    if (ws) ws.close();
  }

  document.addEventListener("DOMContentLoaded", () => {
    for (const input of document.querySelectorAll('input[name="days"]')) {
      input.addEventListener("change", () => {
        days = Number(input.value);
        metrics = null;
        refreshMetrics();
      });
    }
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    start();
  });
})();
