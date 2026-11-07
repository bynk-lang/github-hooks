// CI health page (#20): reads the public metrics routes and redraws.
// Everything that came from GitHub (repository, workflow and branch names) is
// set with textContent, never as markup.
(() => {
  "use strict";

  const NOW_EVERY_MS = 30_000;      // what is running, and the default-branch state
  const METRICS_EVERY_MS = 60_000;  // the window's figures move more slowly
  const LIVE_POLL_MS = 120_000;     // while the live feed is up, polling is only a safety net
  const CACHE_MS = 30_000;          // the routes' `max-age` at the edge
  let days = 7;
  let metrics = null;
  let now = null;
  let history = null;
  // Runner wait (#42): the window's figures, computed hourly by the server,
  // and what is waiting for a runner now. Jobs have no live feed, so these
  // always poll, live or not.
  let runners = null;
  let runnersNow = null;
  // Which workflows' trends are open, by "repo path": kept across redraws.
  const openTrends = new Set();
  // Each source keeps its own freshness, so one succeeding never hides the
  // other failing.
  const fresh = {
    metrics: { lastOk: null, failing: false },
    now: { lastOk: null, failing: false },
    history: { lastOk: null, failing: false },
    runners: { lastOk: null, failing: false },
    runnersNow: { lastOk: null, failing: false },
  };
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

  // Signed in (#53), the maintainers' twin of each route, private and
  // excluded repositories included; otherwise the public route (signin.js).
  const figures = (path, query) => window.bynkMetrics(path, query);
  const signedIn = () => Boolean(window.bynkMaintainer && window.bynkMaintainer());
  const repoMark = (name) => (window.bynkRepoMark ? window.bynkRepoMark(name) : null);

  async function refreshMetrics() {
    const asked = days;
    try {
      const m = await figures("/metrics/ci", { days: asked });
      if (asked !== days) return; // the window changed while this was in flight
      metrics = m;
      ok("metrics");
    } catch (e) {
      if (asked !== days) return;
      failed("metrics", e);
    }
    render();
  }

  async function refreshHistory() {
    const asked = days;
    try {
      const h = await figures("/metrics/ci/history", { days: asked });
      if (asked !== days) return;
      history = indexHistory(h);
      ok("history");
    } catch (e) {
      if (asked !== days) return;
      failed("history", e);
    }
    render();
  }

  // The window figures and history move together: both change only when a
  // run completes.
  function refreshWindow() {
    refreshMetrics();
    refreshHistory();
  }

  async function refreshRunners() {
    const asked = days;
    try {
      const r = await figures("/metrics/runners", { days: asked });
      if (asked !== days) return;
      runners = r;
      ok("runners");
    } catch (e) {
      if (asked !== days) return;
      failed("runners", e);
    }
    render();
  }

  async function refreshRunnersNow() {
    try {
      runnersNow = await figures("/metrics/runners/now");
      ok("runnersNow");
    } catch (e) {
      failed("runnersNow", e);
    }
    render();
  }

  // Group the history by workflow, keyed "repo path".
  function indexHistory(h) {
    const byWorkflow = new Map();
    const entry = (repo, path) => {
      const key = `${repo} ${path}`;
      if (!byWorkflow.has(key)) byWorkflow.set(key, { recent: [], daily: [] });
      return byWorkflow.get(key);
    };
    for (const r of h.recent) entry(r.repo, r.path).recent.push(r);
    for (const d of h.daily) entry(d.repo, d.path).daily.push(d);
    return { since: h.since, until: h.until, byWorkflow };
  }

  async function refreshNow() {
    try {
      now = await figures("/metrics/ci/now");
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
    const problems = [
      describe("now", "Running and default-branch states"),
      describe("metrics", "Window figures"),
      describe("history", "Recent runs and trends"),
      describe("runnersNow", "What's waiting for a runner"),
      describe("runners", "Runner waits"),
    ].filter(Boolean);
    const latest = Object.values(fresh).map((s) => s.lastOk)
      .filter(Boolean).sort((a, b) => b - a)[0];
    if (problems.length > 0) {
      f.textContent = `${problems.join("; ")}.`;
    } else if (latest) {
      f.textContent = live
        ? `${signedIn() ? "Public repositories live, private and not-public ones polled" : "Live"} · updated ${clock(latest)} UTC as runs change`
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

  const conclusionClass = (c) =>
    c === "success" ? "passed" : (c === "failure" || c === "timed_out") ? "failed" : "other";
  const conclusionText = (c) =>
    ({ success: "passed", failure: "failed", timed_out: "timed out" })[c] || `${(c || "unknown").replace("_", " ")}, not counted`;
  const dayLabel = (day) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

  // The latest attempts as a strip, oldest left. Passed and failed are full
  // height; runs the pass rate doesn't count are half height, so the
  // difference never rests on colour alone. Each mark links to its run for a
  // pointer; they aren't tab stops (20 a row would be too many), so one link
  // carries the strip's summary to the workflow's runs on GitHub, for
  // keyboards and screen readers. It shows when focused.
  function recentStrip(runs, workflowName, repo, path) {
    if (!runs || runs.length === 0) return null;
    const counts = { passed: 0, failed: 0, other: 0 };
    for (const r of runs) counts[conclusionClass(r.conclusion)] += 1;
    const latest = runs[runs.length - 1];
    const label = `${workflowName}: last ${runs.length} runs, oldest first: ${counts.passed} passed, ` +
      `${counts.failed} failed or timed out, ${counts.other} not counted. The latest, at ` +
      `${when(latest.completed_at)}, ${conclusionText(latest.conclusion)}.`;
    const marks = el("span", { class: "strip", "aria-hidden": "true" });
    for (const r of runs) {
      const what = `Run ${r.run_id}${r.attempt > 1 ? ` attempt ${r.attempt}` : ""}: ${conclusionText(r.conclusion)}, ` +
        `${when(r.completed_at)}, took ${duration(r.wall_seconds)}` +
        ` · ${r.event}${r.branch ? ` on ${r.branch}` : ""}`;
      marks.append(el("a", {
        class: `run ${conclusionClass(r.conclusion)}`,
        href: `https://github.com/${r.repo}/actions/runs/${r.run_id}/attempts/${r.attempt}`,
        title: what,
        tabindex: "-1",
      }));
    }
    const file = path.split("/").pop();
    const runsLink = el("a", {
      class: "strip-runs",
      href: `https://github.com/${repo}/actions/workflows/${file}`,
      "data-key": `runs:${repo} ${path}`,
      "aria-label": `${label} All ${workflowName} runs on GitHub.`,
    }, "All runs on GitHub");
    return el("span", { class: "strip-wrap" }, marks, runsLink);
  }

  // Every UTC day the window touches, oldest first.
  function windowDays(h) {
    const out = [];
    const end = h.until.slice(0, 10);
    for (let t = Date.parse(`${h.since.slice(0, 10)}T00:00:00Z`); ; t += 86_400_000) {
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

  // One small chart: one measure, one axis. `value(d)` is the day's figure or
  // null; `bar` draws bars (pass rate) rather than a line with points (time).
  function dayChart({ title, allDays, byDay, value, top, tick, describe, bar }) {
    const W = 320, H = 132, L = 44, R = 8, T = 10, B = 22;
    const pw = W - L - R, ph = H - T - B;
    const slot = pw / allDays.length;
    const y = (v) => T + ph - (v / top) * ph;
    const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": title });
    for (const v of [0, top / 2, top]) {
      chart.append(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "grid" }));
      chart.append(svg("text", { x: L - 6, y: y(v) + 4, class: "tick", "text-anchor": "end" }, tick(v)));
    }
    const labelled = new Set([0, allDays.length - 1, Math.floor((allDays.length - 1) / 2)]);
    allDays.forEach((day, i) => {
      if (labelled.has(i)) {
        const anchor = i === 0 ? "start" : i === allDays.length - 1 ? "end" : "middle";
        const x = anchor === "start" ? L : anchor === "end" ? W - R : L + slot * (i + 0.5);
        chart.append(svg("text", { x, y: H - 6, class: "tick", "text-anchor": anchor }, dayLabel(day)));
      }
    });
    let path = "";
    let pen = false;
    allDays.forEach((day, i) => {
      const d = byDay.get(day);
      const v = d ? value(d) : null;
      const cx = L + slot * (i + 0.5);
      if (v == null) { pen = false; return; }
      if (bar) {
        const w = Math.max(2, Math.min(14, slot - 2));
        const h = Math.max(2, (v / top) * ph);
        // Rounded data end, square at the baseline.
        const r = Math.min(3, w / 2, h);
        const x0 = cx - w / 2, y0 = T + ph - h;
        chart.append(svg("path", {
          class: "mark",
          d: `M${x0},${T + ph}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${T + ph}Z`,
        }));
      } else {
        path += `${pen ? "L" : "M"}${cx},${y(v)}`;
        pen = true;
      }
    });
    if (!bar && path) chart.append(svg("path", { class: "line", d: path }));
    // Points only while there is room for them; past two weeks they would
    // crowd the line, and each day's column still answers on hover.
    if (!bar && allDays.length <= 15) {
      allDays.forEach((day, i) => {
        const d = byDay.get(day);
        const v = d ? value(d) : null;
        if (v != null) chart.append(svg("circle", { class: "point", cx: L + slot * (i + 0.5), cy: y(v), r: 4 }));
      });
    }
    // Hover targets: the whole day's column, wider than any mark.
    allDays.forEach((day, i) => {
      const d = byDay.get(day);
      chart.append(svg("rect", { class: "hit", x: L + slot * i, y: T, width: slot, height: ph },
        svg("title", {}, `${dayLabel(day)}: ${d ? describe(d) : "no completed runs"}`)));
    });
    return el("figure", { class: "trend-chart" }, el("figcaption", {}, title), chart);
  }

  function niceTop(seconds) {
    const steps = [60, 120, 300, 600, 900, 1200, 1800, 2400, 3600, 5400, 7200, 10800, 14400, 21600, 43200, 86400];
    return steps.find((s) => s >= seconds) || Math.ceil(seconds / 86400) * 86400;
  }
  const shortDuration = (s) => (s === 0 ? "0" : s < 3600 ? `${Math.round(s / 60)} m` : `${+(s / 3600).toFixed(1)} h`);

  // This workflow's jobs among the repository's slowest (#42): the figures
  // keep each repository's 10 slowest jobs by median, with at least 3
  // successful runs in the window, matched to the workflow by its name (jobs
  // don't carry the workflow's path), so two workflows of the same name in a
  // repository share them.
  function slowestJobs(repoName, workflowName) {
    if (!runners || !runners.computed_at) return null;
    const jobs = runners.slowest.filter((j) => j.repo === repoName && j.workflow === workflowName);
    const box = el("div", { class: "slowest" }, el("h4", {}, "Slowest jobs"));
    if (jobs.length === 0) {
      box.append(el("p", { class: "empty" },
        "None of this workflow's jobs is among the repository's 10 slowest (with at least 3 successful runs) in this window."));
      return box;
    }
    const rows = el("tbody");
    for (const j of jobs) {
      rows.append(el("tr", {},
        el("th", { scope: "row" }, j.name),
        el("td", { class: "num", "data-label": "Successful runs" }, j.runs),
        el("td", { class: "num", "data-label": "Median time" }, duration(j.p50_seconds) || "—"),
        el("td", { class: "num", "data-label": "95th pct time" }, duration(j.p95_seconds) || "—")));
    }
    box.append(el("table", { class: "compact" },
      el("caption", { class: "visually-hidden" }, `${workflowName}: its slowest jobs, by median time of successful runs`),
      el("thead", {}, el("tr", {},
        el("th", { scope: "col" }, "Job"),
        el("th", { scope: "col", class: "num" }, "Successful runs"),
        el("th", { scope: "col", class: "num" }, "Median time"),
        el("th", { scope: "col", class: "num" }, "95th pct time"))),
      rows));
    return box;
  }

  function trendPanel(name, key, entry, repoName) {
    const daily = entry ? entry.daily : [];
    const byDay = new Map(daily.map((d) => [d.day, d]));
    const allDays = windowDays(history);
    const judged = (d) => d.success + d.failed;
    const panel = el("div", { class: "trend" });
    if (daily.length === 0) {
      panel.append(el("p", { class: "empty" }, "No completed runs in this window."));
      const slow = slowestJobs(repoName, name);
      if (slow) panel.append(slow);
      return panel;
    }
    const maxWall = Math.max(0, ...daily.map((d) => d.wall_p50_seconds || 0));
    panel.append(el("div", { class: "trend-charts" },
      dayChart({
        title: `${name}: pass rate by day (UTC)`,
        allDays, byDay, bar: true, top: 100,
        value: (d) => d.pass_percent,
        tick: (v) => `${v}%`,
        describe: (d) => d.pass_percent == null
          ? `${d.runs} runs, none counted`
          : `${d.pass_percent}% (${d.success} of ${judged(d)} passed)`,
      }),
      dayChart({
        title: `${name}: median wall-clock time of passed runs, by day (UTC)`,
        allDays, byDay, bar: false, top: niceTop(maxWall || 60),
        value: (d) => d.wall_p50_seconds,
        tick: shortDuration,
        describe: (d) => d.wall_p50_seconds == null
          ? "no passed runs"
          : `median ${duration(d.wall_p50_seconds)} over ${d.success} passed`,
      })));
    const rows = el("tbody");
    for (const d of daily) {
      rows.append(el("tr", {},
        el("th", { scope: "row" }, dayLabel(d.day)),
        el("td", { class: "num" }, d.runs),
        el("td", { class: "num" }, d.success),
        el("td", { class: "num" }, d.failed),
        el("td", { class: "num" }, d.other),
        el("td", { class: "num" }, d.pass_percent == null ? "—" : `${d.pass_percent}%`),
        el("td", { class: "num" }, duration(d.wall_p50_seconds) || "—")));
    }
    panel.append(el("details", { class: "trend-table", "data-key": `table:${key}` },
      el("summary", { "data-key": `table-summary:${key}` }, "Daily figures"),
      el("table", {},
        el("caption", { class: "visually-hidden" }, `${name}, by day (UTC)`),
        el("thead", {}, el("tr", {},
          el("th", { scope: "col" }, "Day"),
          el("th", { scope: "col", class: "num" }, "Runs"),
          el("th", { scope: "col", class: "num" }, "Passed"),
          el("th", { scope: "col", class: "num" }, "Failed"),
          el("th", { scope: "col", class: "num" }, "Not counted"),
          el("th", { scope: "col", class: "num" }, "Pass rate"),
          el("th", { scope: "col", class: "num" }, "Median time"))),
        rows)));
    const slow = slowestJobs(repoName, name);
    if (slow) panel.append(slow);
    const rerun = signedIn() ? rerunList(entry) : null;
    if (rerun) panel.append(rerun);
    return panel;
  }

  // Signed in (#53, step 5): the workflow's recent runs whose latest attempt
  // failed, newest first, each with a button that re-runs its failed jobs,
  // after asking. What happened stays beside the run across redraws.
  const actionNotes = new Map(); // "repo run_id" -> text
  const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
  function rerunList(entry) {
    if (!entry || entry.recent.length === 0) return null;
    const latest = new Map();
    for (const r of entry.recent) {
      const seen = latest.get(r.run_id);
      if (!seen || r.attempt > seen.attempt) latest.set(r.run_id, r);
    }
    const failed = [...latest.values()].filter((r) => FAILED.has(r.conclusion))
      .sort((a, b) => b.completed_at.localeCompare(a.completed_at)).slice(0, 5);
    if (failed.length === 0) return null;
    const list = el("ul", { class: "rerun-list" });
    for (const r of failed) {
      const key = `${r.repo} ${r.run_id}`;
      const note = el("span", { class: "rerun-note", "aria-live": "polite" }, actionNotes.get(key) || "");
      const button = el("button", { type: "button", class: "link-button" }, "Re-run failed jobs");
      button.addEventListener("click", async () => {
        const what = `run ${r.run_id}${r.attempt > 1 ? ` (attempt ${r.attempt})` : ""} of ${r.repo}`;
        if (!window.confirm(`Re-run the failed jobs of ${what} on GitHub?`)) return;
        button.disabled = true;
        note.textContent = "Asking GitHub…";
        const done = await window.bynkAct("/maintainers/actions/rerun", { repo: r.repo, run_id: r.run_id });
        actionNotes.set(key, done.message);
        note.textContent = done.message;
        button.disabled = false;
      });
      list.append(el("li", {},
        el("a", { href: `https://github.com/${r.repo}/actions/runs/${r.run_id}/attempts/${r.attempt}` },
          `Run ${r.run_id}${r.attempt > 1 ? ` attempt ${r.attempt}` : ""}`),
        ` ${conclusionText(r.conclusion)} ${when(r.completed_at)}${r.branch ? ` on ${r.branch}` : ""} · `,
        button, " ", note));
    }
    return el("div", { class: "rerun" }, el("h4", {}, "Failed recently"), list);
  }

  // Median to 95th percentile as a thin range on a shared scale, with a point
  // at the median: the spread is the story (most jobs start at once; some
  // wait minutes). The figures are in the row beside it.
  function waitRange(w, top) {
    if (w.p50_seconds == null || w.p95_seconds == null || top <= 0) return null;
    const at = (s) => `${Math.min(100, (s / top) * 100)}%`;
    const label = `Median ${duration(w.p50_seconds)}, 95th percentile ${duration(w.p95_seconds)}`;
    const range = el("div", { class: "range", role: "img", "aria-label": label, title: label });
    const span = el("span", { class: "range-span" });
    span.style.left = at(w.p50_seconds);
    span.style.width = `calc(${at(w.p95_seconds)} - ${at(w.p50_seconds)})`;
    const dot = el("span", { class: "range-dot" });
    dot.style.left = at(w.p50_seconds);
    range.append(span, dot);
    return range;
  }

  // What is waiting for a runner, for one runner label.
  function waitingText(n) {
    if (!n) return null;
    const parts = [];
    if (n.queued > 0) {
      parts.push(`${n.queued} queued${n.oldest_queued_at ? `, oldest ${since(n.oldest_queued_at)}` : ""}`);
    }
    if (n.awaiting_approval > 0) parts.push(`${n.awaiting_approval} awaiting approval`);
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  // A repository's runner wait (#42): waits by runner label over the window,
  // what is waiting now, and the longest waits. The window's figures are
  // computed hourly, so the note says when.
  function runnerSection(repoName, r) {
    if (!runners && !runnersNow) return null;
    const byRunner = new Map();
    const runner = (label) => {
      if (!byRunner.has(label)) byRunner.set(label, { wait: null, now: null });
      return byRunner.get(label);
    };
    for (const w of r.waits) runner(w.runner).wait = w;
    for (const n of r.waiting) runner(n.runner).now = n;
    const box = el("section", { class: "runners", "aria-labelledby": `runners-${repoName}` },
      el("h3", { id: `runners-${repoName}` }, "Waiting for runners"));

    const notes = [];
    if (runners && runners.computed_at) {
      notes.push(`Computed hourly, last at ${clock(new Date(runners.computed_at))} UTC`);
      if (runners.data_since && Date.parse(runners.data_since) > Date.parse(runners.since)) {
        notes.push(`jobs recorded since ${when(runners.data_since)}`);
      }
    } else if (runners) {
      notes.push("The window's figures are computed hourly; the first computation hasn't run yet");
    }
    if (notes.length > 0) box.append(el("p", { class: "aside" }, `${notes.join(" · ")}.`));

    if (byRunner.size === 0) {
      box.append(el("p", { class: "empty" }, "No job started on a runner in this window, and nothing is waiting."));
      return box;
    }
    // Busiest first, as the figures come; labels with only waiting jobs after.
    const rows = [...byRunner].sort(([an, a], [bn, b]) =>
      ((b.wait ? b.wait.jobs : -1) - (a.wait ? a.wait.jobs : -1)) || an.localeCompare(bn));
    const top = niceTop(Math.max(0, ...rows.map(([, x]) => (x.wait && x.wait.p95_seconds) || 0)) || 60);
    const body = el("tbody");
    for (const [label, { wait: w, now: n }] of rows) {
      const range = w ? waitRange(w, top) : null;
      const waiting = waitingText(n);
      body.append(el("tr", {},
        el("td", { class: "workflow" }, label),
        cell("Jobs", w ? w.jobs : null),
        cell("Median wait", w ? duration(w.p50_seconds) : null),
        cell("95th pct wait", w ? duration(w.p95_seconds) : null),
        range
          ? el("td", { class: "bar-cell", "data-label": "Spread" }, range)
          : el("td", { class: "bar-cell none", "data-label": "Spread" }, "—"),
        cell("Longest", w ? duration(w.longest_seconds) : null),
        waiting
          ? el("td", { class: "waiting", "data-label": "Waiting now" }, waiting)
          : el("td", { class: "waiting none", "data-label": "Waiting now" }, "Nothing")));
    }
    box.append(el("div", { class: "table-wrap" }, el("table", {},
      el("caption", { class: "visually-hidden" }, `Waits for a runner in ${repoName}, ${days}-day window, by runner label`),
      el("thead", {}, el("tr", {},
        el("th", { scope: "col" }, "Runner"),
        el("th", { scope: "col", class: "num" }, "Jobs"),
        el("th", { scope: "col", class: "num" }, "Median wait"),
        el("th", { scope: "col", class: "num" }, "95th pct wait"),
        el("th", { scope: "col" }, `Median to 95th pct (0 to ${shortDuration(top)})`),
        el("th", { scope: "col", class: "num" }, "Longest"),
        el("th", { scope: "col" }, "Waiting now"))),
      body)));

    if (r.longest.length > 0) {
      const list = el("ol", { class: "longest" });
      for (const l of r.longest) {
        list.append(el("li", {},
          el("a", { href: l.url, "data-key": `job:${l.url}` }, l.name),
          ` · ${l.workflow} · ${l.runner} · waited ${duration(l.wait_seconds)}, queued ${when(l.queued_at)}`));
      }
      box.append(el("details", { class: "in-flight", "data-key": `longest:${repoName}` },
        el("summary", { "data-key": `longest-summary:${repoName}` }, `Longest waits (${r.longest.length})`), list));
    }
    return box;
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
    if (!metrics && !now && !runners && !runnersNow) return;
    const repos = new Map();
    const repo = (name) => {
      if (!repos.has(name)) repos.set(name, { workflows: new Map(), running: [], waits: [], waiting: [], longest: [] });
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
    for (const w of runners ? runners.runners : []) repo(w.repo).waits.push(w);
    for (const l of runners ? runners.longest : []) repo(l.repo).longest.push(l);
    for (const n of runnersNow ? runnersNow.waiting : []) repo(n.repo).waiting.push(n);

    if (repos.size === 0) {
      root.append(el("p", { class: "empty" }, "No public repository has a completed run in this window yet."));
      return;
    }

    for (const [name, r] of [...repos].sort(([a], [b]) => a.localeCompare(b))) {
      const section = el("section", { class: "repo", "aria-labelledby": `repo-${name}` });
      const running = r.running.length;
      section.append(el("div", { class: "repo-head" },
        el("h2", { id: `repo-${name}` },
          el("a", { href: `https://github.com/${name}/actions`, "data-key": `link:${name}` }, name), repoMark(name)),
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
          el("th", { scope: "col" }, "Conclusions"),
          el("th", { scope: "col" }, "Recent runs"))));
      const body = el("tbody");
      const rows = [...r.workflows].sort(([, a], [, b]) => {
        const an = (a.health && a.health.workflow) || (a.state && a.state.workflow) || "";
        const bn = (b.health && b.health.workflow) || (b.state && b.state.workflow) || "";
        return an.localeCompare(bn);
      });
      for (const [path, { health: h, state }] of rows) {
        const nameText = (h && h.workflow) || (state && state.workflow) || path;
        const key = `${name} ${path}`;
        const entry = history ? history.byWorkflow.get(key) : null;
        const isOpen = openTrends.has(key);
        const trendId = `trend-${key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
        const toggle = history
          ? el("button", {
            type: "button", class: "trend-toggle", "aria-expanded": String(isOpen),
            "aria-controls": trendId, "data-key": `trend:${key}`,
          }, isOpen ? "Hide trend" : "Trend")
          : null;
        if (toggle) {
          toggle.addEventListener("click", () => {
            if (openTrends.has(key)) openTrends.delete(key); else openTrends.add(key);
            renderRepos();
          });
        }
        const strip = history ? recentStrip(entry && entry.recent, nameText, name, path) : null;
        body.append(el("tr", {},
          el("td", { class: "workflow" }, nameText, el("small", {}, path), toggle),
          el("td", { class: "state-cell", "data-label": "Default branch" }, stateCell(state)),
          cell("Pass rate", h && h.pass_percent != null ? `${h.pass_percent}%` : null),
          cell("Runs", h ? h.runs : null),
          cell("Median time", h ? duration(h.wall_p50_seconds) : null),
          cell("95th pct time", h ? duration(h.wall_p95_seconds) : null),
          cell("Flaky", h ? h.flaky : null),
          h
            ? el("td", { class: "bar-cell", "data-label": "Conclusions" }, conclusionsBar(h))
            : el("td", { class: "bar-cell none", "data-label": "Conclusions" }, "No runs in this window"),
          strip
            ? el("td", { class: "strip-cell", "data-label": "Recent runs" }, strip)
            : el("td", { class: "strip-cell none", "data-label": "Recent runs" }, "—")));
        if (history && isOpen) {
          body.append(el("tr", { class: "trend-row", id: trendId },
            el("td", { colspan: "9" }, trendPanel(nameText, key, entry, name))));
        }
      }
      table.append(body);
      if (r.workflows.size > 0) section.append(el("div", { class: "table-wrap" }, table));
      else section.append(el("p", { class: "empty" }, "No completed run in this window."));

      if (running > 0) {
        const list = el("ul");
        for (const f of r.running) {
          list.append(el("li", {},
            `${f.workflow} · ${f.event}${f.branch ? ` on ${f.branch}` : ""} · ${f.status.replace("_", " ")}, queued ${since(f.queued_at)} ago`));
        }
        section.append(el("details", { class: "in-flight", "data-key": `running:${name}` },
          el("summary", { "data-key": `summary:${name}` }, `Running now (${running})`), list));
      }
      const runnerBox = runnerSection(name, r);
      if (runnerBox) section.append(runnerBox);
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
  // Runner wait has no live feed, so it keeps its own pace either way.
  let timers = [];
  function poll() {
    timers.forEach(clearInterval);
    timers = [
      ...(live && !signedIn()
        ? [setInterval(refreshWindow, LIVE_POLL_MS), setInterval(refreshNow, LIVE_POLL_MS)]
        : [setInterval(refreshWindow, METRICS_EVERY_MS), setInterval(refreshNow, NOW_EVERY_MS)]),
      setInterval(refreshRunners, METRICS_EVERY_MS),
      setInterval(refreshRunnersNow, NOW_EVERY_MS),
    ];
  }
  function start() {
    refreshWindow();
    refreshNow();
    refreshRunners();
    refreshRunnersNow();
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
  let completedSince = false; // did a run complete before the pending refetch?
  let retryMs = 5_000;
  let retry = null;
  // A fresh id per connection: the server drops a connection by id when it
  // closes, so reusing one would let an old socket's late close remove the new.
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
    ws.onopen = () => {
      live = true;
      retryMs = 5_000;
      poll();
      renderFreshness();
    };
    // Only a completed run moves the window's figures and history; any
    // change moves what is running.
    ws.onmessage = (m) => {
      let e = null;
      try {
        e = JSON.parse(m.data);
      } catch {
        // unreadable: assume the worst and refetch it all, after the longest wait
      }
      if (e && e.kind && e.kind !== "run") return; // pull requests and releases are the other pages'
      if (!e || e.status === "completed") completedSince = true;
      onLiveEvent(e ? e.refetch_ms : undefined, () => {
        refreshNow();
        if (completedSince) refreshWindow();
        completedSince = false;
      });
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
        metrics = null;
        history = null;
        runners = null;
        refreshWindow();
        refreshRunners();
      });
    }
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    start();
  });
})();
