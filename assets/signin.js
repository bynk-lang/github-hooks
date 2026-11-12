// Signing maintainers in (#53), shared by every page. A maintainer signs in
// with GitHub, through the GitHub App's user authorisation, with the
// authorisation-code flow and PKCE. The page hands the code and its verifier
// to the Worker (`POST /maintainers/token`), which exchanges them with the
// App's client secret, checks the person belongs to the organisation, and
// answers its own token for them. That token is kept in `sessionStorage`, so
// it lasts as long as the tab, and sent as `Authorization: Bearer` to the
// maintainer routes. Other scripts read the signed-in maintainer from
// `window.bynkMaintainer`, fetch their figures with `window.bynkMetrics`
// (the maintainers' twins when signed in), and mark the repositories only
// maintainers see with `window.bynkRepoMark`. This script loads first.
(() => {
  "use strict";

  const KEY = "bynk.maintainer";        // { token, expires, login }
  const PENDING = "bynk.signin";         // { verifier, state, back } while GitHub is asked
  const CALLBACK = "/maintainers/callback";

  const store = {
    get(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } },
    set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
    drop(key) { try { sessionStorage.removeItem(key); } catch { /* private mode */ } },
  };

  // The signed-in maintainer, or null once the token has expired.
  function current() {
    const m = store.get(KEY);
    if (!m || !m.token || !m.expires || Date.now() >= m.expires) return null;
    return m;
  }

  const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const random = (n) => base64url(crypto.getRandomValues(new Uint8Array(n)));

  async function getJson(path, init) {
    const res = await fetch(path, { cache: "no-store", ...init, headers: { accept: "application/json", ...(init && init.headers) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = body.message || body.error || `HTTP ${res.status}`;
      throw new Error(why);
    }
    return body;
  }

  async function signIn() {
    const config = await getJson("/maintainers/config");
    const verifier = random(32);
    const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const state = random(16);
    store.set(PENDING, { verifier, state, back: location.pathname + location.search });
    const url = new URL(config.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: config.client_id,
      redirect_uri: location.origin + CALLBACK,
      allow_signup: "false",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    location.assign(url.toString());
  }

  // Signing out forgets this service's token. The GitHub sign-in itself is
  // GitHub's: the next sign-in may not ask again.
  // Signing out ends the session on the server (#53, step 5): every token
  // issued to this login before now is refused, on any device. The tab
  // forgets its token only once the Worker has done that, or once the token
  // is refused anyway (401, 403). Otherwise the person is told, and stays
  // signed in to try again, so "Sign out" never claims more than it did.
  async function signOut() {
    const m = current();
    if (m) {
      let ended = false;
      try {
        const res = await fetch("/maintainers/signout", { method: "POST", cache: "no-store", headers: { authorization: `Bearer ${m.token}` } });
        ended = res.ok || res.status === 401 || res.status === 403;
      } catch (e) {
        console.warn("Couldn't end the session on the server:", e.message);
      }
      if (!ended) {
        window.alert("The sign-out didn't reach the server, so your other devices may still be signed in. You're still signed in here: try again in a moment.");
        return;
      }
    }
    store.drop(KEY);
    location.reload();
  }

  // On the callback page: check the state, finish the sign-in through the
  // Worker, and go back where the sign-in started.
  async function finish() {
    const status = document.getElementById("signin-status");
    const say = (text) => { if (status) status.textContent = text; };
    const params = new URLSearchParams(location.search);
    const pending = store.get(PENDING);
    store.drop(PENDING);
    if (params.get("error")) { say(`GitHub didn't sign you in: ${params.get("error_description") || params.get("error")}.`); return; }
    if (!pending || !params.get("code") || params.get("state") !== pending.state) {
      say("This sign-in didn't start here, or has expired. Start it again from a dashboard.");
      return;
    }
    try {
      const signed = await getJson("/maintainers/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: params.get("code"), code_verifier: pending.verifier, redirect_uri: location.origin + CALLBACK }),
      });
      const lasts = (signed.expires_in || 3600) * 1000;
      store.set(KEY, { token: signed.token, expires: Date.now() + lasts - 60_000, login: signed.login });
      say(`Signed in as ${signed.login}. Taking you back…`);
      location.replace(pending.back || "/");
    } catch (e) {
      say(`The sign-in didn't complete: ${e.message}.`);
    }
  }

  // On a dashboard: the sign-in link, or who is signed in and a sign-out.
  function renderLink() {
    // The page's wording follows: signed in, it covers every repository.
    document.documentElement.classList.toggle("signed-in", Boolean(current()));
    const slot = document.getElementById("signin");
    if (!slot) return;
    const m = current();
    slot.replaceChildren();
    const button = (label, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "link-button";
      b.textContent = label;
      b.addEventListener("click", onClick);
      return b;
    };
    if (m) {
      const who = document.createElement("span");
      who.className = "signed-in";
      who.textContent = `Signed in as ${m.login}`;
      slot.append(who, " · ", button("Sign out", () => signOut()));
    } else {
      slot.append(button("Maintainer sign-in", () => signIn().catch((e) => console.warn("Sign-in failed to start:", e.message))));
    }
  }

  // The dashboards' figures (#53, step 3). Signed in, each comes from the
  // public route's maintainer twin: the same query string, with the token,
  // over every repository, private and excluded ones too, and never kept.
  // Signed out, from the public route, as before. A token the Worker refuses
  // (expired, or its holder has left the organisation) signs the page out,
  // and the public figures are fetched instead.
  async function metrics(path, query = {}) {
    const m = current();
    const pairs = Object.entries(query).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]);
    const qs = new URLSearchParams(pairs).toString();
    if (!m) {
      // Always ask the edge, never the browser's own copy: a live change
      // purges the edge, which the browser's cache wouldn't know about.
      const res = await fetch(`${path}${qs ? `?${qs}` : ""}`, { cache: "no-cache", headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(res.status === 429 ? "rate limited" : `HTTP ${res.status}`);
      return res.json();
    }
    const res = await fetch(`/maintainers${path}${qs ? `?${qs}` : ""}`, {
      cache: "no-store",
      headers: { accept: "application/json", authorization: `Bearer ${m.token}` },
    });
    if (res.status === 401 || res.status === 403) {
      console.warn(`Maintainer figures refused (HTTP ${res.status}); signing out.`);
      forget();
      return metrics(path, query);
    }
    if (!res.ok) throw new Error(res.status === 429 ? "rate limited" : `HTTP ${res.status}`);
    return res.json();
  }

  // Which repositories only maintainers see (#53, step 3), by lower-cased
  // name, from `/maintainers/repositories`: loaded once a page opens signed
  // in, then the page is told to redraw (`bynk:repositories`).
  let shown = new Map();
  async function loadRepositories() {
    const m = current();
    if (!m) return;
    try {
      const listed = await getJson("/maintainers/repositories", { headers: { authorization: `Bearer ${m.token}` } });
      shown = new Map(listed.map((r) => [r.repo.toLowerCase(), r]));
      document.dispatchEvent(new CustomEvent("bynk:repositories"));
    } catch (e) {
      console.warn("Couldn't load which repositories are private:", e.message);
    }
  }

  // The mark beside a repository's name on a signed-in page: "private", or
  // "not public" for one `DASHBOARD_EXCLUDE` keeps off the public pages, or
  // nothing for one everyone sees.
  function repoMark(name) {
    const r = shown.get(String(name).toLowerCase());
    if (!r || (r.public && !r.excluded)) return null;
    const mark = document.createElement("span");
    mark.className = "repo-mark";
    mark.textContent = r.public ? "not public" : "private";
    mark.title = r.public
      ? "Kept off the public pages (DASHBOARD_EXCLUDE): only maintainers see it"
      : "A private repository: only maintainers see it";
    return mark;
  }

  // Signing out, or a token refused: forget it, and redraw the link.
  function forget() {
    store.drop(KEY);
    closeMaintainersLive();
    shown = new Map();
    mine = null;
    renderMine();
    renderLink();
    document.dispatchEvent(new CustomEvent("bynk:repositories"));
  }

  // The page's "Mine" section (#53, step 4): what is the signed-in
  // maintainer's to act on, from `GET /maintainers/mine`, shown above the
  // repositories. Each page asks for its own part (`data-mine`): CI, their
  // pull requests whose CI is failing; PR flow, their open pull requests and
  // those waiting on their review; issues, their open issues; releases, their
  // merges waiting to ship. Everything from GitHub is set as text.
  const MINE_EVERY_MS = 60_000;
  let mine = null;
  async function loadMine() {
    const m = current();
    if (!m) { mine = null; renderMine(); return; }
    try {
      const res = await fetch("/maintainers/mine", { cache: "no-store", headers: { accept: "application/json", authorization: `Bearer ${m.token}` } });
      if (res.status === 401 || res.status === 403) { forget(); return; }
      if (!res.ok) throw new Error(res.status === 429 ? "rate limited" : `HTTP ${res.status}`);
      mine = await res.json();
    } catch (e) {
      console.warn("Couldn't load what's yours:", e.message);
    }
    renderMine();
  }

  const node = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    for (const c of children) if (c != null) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
    if (s < 172800) return `${Math.round(s / 3600)} h`;
    return `${Math.round(s / 86400)} days`;
  };
  const link = (repo, number, kind, title) =>
    node("a", { href: `https://github.com/${repo}/${kind}/${number}` }, `${repo}#${number}`, " ", title);
  const CI_LABEL = { failing: "CI failing", running: "CI running", passing: "CI passing" };
  const STAGE_LABEL = { draft: "draft", queued: "in the merge queue", ready: "ready" };

  function list(title, items, empty, row) {
    const box = node("div", {}, node("h3", {}, title));
    if (items.length === 0) box.append(node("p", { class: "mine-empty" }, empty));
    else box.append(node("ul", { class: "mine-list" }, ...items.map((i) => node("li", {}, ...row(i)))));
    return box;
  }

  function renderMine() {
    const slot = document.getElementById("mine");
    if (!slot) return;
    const m = current();
    if (!m || !mine) { slot.hidden = true; slot.replaceChildren(); return; }
    const kind = slot.dataset.mine;
    const parts = [];
    if (kind === "ci") {
      const failing = mine.pulls.filter((p) => p.ci === "failing");
      parts.push(list("Your pull requests failing CI", failing, "None of your open pull requests is failing CI.",
        (p) => [link(p.repo, p.number, "pull", p.title), " · ", node("span", { class: "mine-ci failing" }, "CI failing")]));
    } else if (kind === "prs") {
      parts.push(list("Your open pull requests", mine.pulls, "You have no open pull requests.",
        (p) => [link(p.repo, p.number, "pull", p.title), " · ", STAGE_LABEL[p.stage] || p.stage,
          p.stage === "draft" ? null : ` for ${ago(p.ready_since || p.opened_at)}`,
          p.ci ? " · " : null, p.ci ? node("span", { class: `mine-ci ${p.ci}` }, CI_LABEL[p.ci] || p.ci) : null]));
      parts.push(list("Waiting on your review", mine.reviews, "Nothing is waiting on your review.",
        (r) => [link(r.repo, r.number, "pull", r.title), ` · by ${r.author}`,
          r.draft ? " · draft" : ` · ready for ${ago(r.ready_since || r.opened_at)}`]));
    } else if (kind === "issues") {
      parts.push(list("Your open issues", mine.issues, "You have no open issues.",
        (i) => [link(i.repo, i.number, "issues", i.title), ` · opened ${ago(i.opened_at)} ago`,
          i.stale ? " · " : null, i.stale ? node("span", { class: "mine-stale" }, `stale, no update for ${ago(i.updated_at)}`) : null]));
    } else if (kind === "releases") {
      parts.push(list("Your merges waiting to ship", mine.unreleased, "Nothing of yours is waiting for a release.",
        (u) => [link(u.repo, u.number, "pull", u.title), ` · merged ${ago(u.merged_at)} ago`]));
    }
    // The App's proposals (#88) are every maintainer's, so every page shows
    // them, first; and, once Claude is in use, today's calls against the caps.
    const proposals = mine.proposals || [];
    if (proposals.length > 0) parts.unshift(proposalList(proposals));
    const claude = mine.claude;
    if (claude && (claude.calls > 0 || proposals.length > 0)) {
      parts.push(node("p", { class: "mine-claude" },
        `Claude today: ${claude.calls} of ${claude.total_cap} calls; the busiest repository ${claude.busiest} of ${claude.repo_cap}.`));
    }
    slot.replaceChildren(node("div", { class: "repo-head" }, node("h2", { id: "mine-title" }, `Yours, ${m.login}`)), ...parts);
    slot.hidden = false;
  }

  // "Proposed by the App" (#88): what the App would do, and why, each with
  // Approve and Decline. Nothing reaches GitHub until a maintainer approves.
  // Approving asks GitHub at once, so it's confirmed first; the outcome is
  // shown beside it, and Mine reloads (every open page hears it too).
  const proposalNotes = new Map();
  function proposalList(proposals) {
    return list("Proposed by the App", proposals, "", (p) => {
      const note = node("span", { class: "proposal-note", "aria-live": "polite" }, proposalNotes.get(p.id) || "");
      const decide = (verb, path, confirmText) => {
        const b = node("button", { type: "button", class: "link-button" }, verb);
        b.addEventListener("click", async () => {
          if (confirmText && !window.confirm(confirmText)) return;
          b.disabled = true;
          note.textContent = verb === "Approve" ? "Asking GitHub…" : "Declining…";
          const done = await act(path, { id: p.id });
          proposalNotes.set(p.id, done.message);
          note.textContent = done.message;
          b.disabled = false;
          loadMine();
        });
        return b;
      };
      const what = p.kind === "labels" ? `add ${p.labels.join(", ")}` : p.kind;
      const kind = p.kind === "labels" ? "issues" : "pull";
      return [
        link(p.repo, p.target, kind, p.title || ""), ` · ${what} · `, node("span", { class: "proposal-reason" }, p.reason),
        ` · proposed ${ago(p.proposed_at)} ago · `,
        decide("Approve", "/maintainers/proposals/approve", `Approve: ${what} on ${p.repo}#${p.target}? The App does it on GitHub at once.`),
        " ", decide("Decline", "/maintainers/proposals/decline", null), " ", note,
      ];
    });
  }

  // A maintainer's action (#53, step 5): POSTs `body` as JSON with the
  // token, and answers `{ ok, message }` in words for the page to show. A
  // refused token signs the page out.
  async function act(path, body) {
    const m = current();
    if (!m) return { ok: false, message: "Sign in to do this." };
    try {
      const res = await fetch(path, {
        method: "POST",
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${m.token}` },
        body: JSON.stringify(body),
      });
      const answer = await res.json().catch(() => ({}));
      // A 401 or 403 is the maintainer check refusing (a session ended, or
      // someone who has left); GitHub's own refusals come back as a 502.
      if (res.status === 401 || res.status === 403) forget();
      if (res.ok) return { ok: true, message: answer.message || "Done." };
      return { ok: false, message: answer.message || answer.error || (res.status === 429 ? "Too many actions; try again in a minute." : `HTTP ${res.status}`) };
    } catch (e) {
      return { ok: false, message: `Couldn't reach the service: ${e.message}` };
    }
  }

  // The maintainers' live board (#68): signed in, the page also hears the
  // changes the public board leaves out (private and excluded repositories).
  // First `POST /maintainers/live` checks the token (as every maintainer route
  // does) and has the board expect a fresh client id; then the socket opens
  // with it. The board closes it after an hour, or at sign-out, and the page
  // asks again, through a fresh check. Each page hands in its own live
  // handler (`window.bynkMaintainersLive(onMessage)`), which hears both
  // boards' frames alike. Signed out, nothing opens; a refused token signs the
  // page out.
  const liveHandlers = [];
  let maintainersSocket = null; // a WebSocket, "asking" while the board is asked, or null
  let maintainersRetry = null;
  let maintainersRetryMs = 5_000;
  const newClientId = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  function maintainersLive(onMessage) {
    liveHandlers.push(onMessage);
    openMaintainersLive();
  }
  async function openMaintainersLive() {
    if (maintainersSocket || liveHandlers.length === 0 || !("WebSocket" in globalThis) || document.hidden) return;
    const m = current();
    if (!m) return;
    const client = newClientId();
    maintainersSocket = "asking";
    let expected = false;
    try {
      const res = await fetch("/maintainers/live", {
        method: "POST",
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${m.token}` },
        body: JSON.stringify({ client }),
      });
      if (res.status === 401 || res.status === 403) { maintainersSocket = null; forget(); return; }
      expected = res.ok;
    } catch (e) {
      console.warn("Couldn't join the maintainers' live board:", e.message);
    }
    if (maintainersSocket !== "asking") return; // signed out meanwhile
    if (!expected) { maintainersSocket = null; retryMaintainersLive(); return; }
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/live?board=maintainers&client=${client}`);
    maintainersSocket = ws;
    ws.onopen = () => { maintainersRetryMs = 5_000; announceMaintainersLive(); };
    ws.onmessage = (frame) => {
      // A proposal's change (#88) is Mine's, not a page's figures.
      try { if (JSON.parse(frame.data).kind === "proposal") { loadMine(); return; } } catch { /* the pages' to judge */ }
      for (const handle of liveHandlers) handle(frame);
    };
    ws.onclose = () => {
      if (maintainersSocket !== ws) return;
      maintainersSocket = null;
      announceMaintainersLive();
      retryMaintainersLive();
    };
  }
  function retryMaintainersLive() {
    clearTimeout(maintainersRetry);
    if (!current() || document.hidden) return;
    maintainersRetry = setTimeout(openMaintainersLive, maintainersRetryMs);
    maintainersRetryMs = Math.min(maintainersRetryMs * 2, 60_000);
  }
  function closeMaintainersLive() {
    clearTimeout(maintainersRetry);
    const ws = maintainersSocket;
    maintainersSocket = null;
    if (ws && ws !== "asking") ws.close();
    announceMaintainersLive();
  }
  // Whether the maintainers' board is open, so a signed-in page can rely on
  // it as on the public one: pages listen for `bynk:maintainers-live`.
  const maintainersLiveOpen = () => typeof maintainersSocket === "object" && maintainersSocket !== null && maintainersSocket.readyState === 1;
  function announceMaintainersLive() {
    document.dispatchEvent(new CustomEvent("bynk:maintainers-live"));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) closeMaintainersLive();
    else openMaintainersLive();
  });

  window.bynkMaintainer = current;
  window.bynkMaintainersLive = maintainersLive;
  window.bynkMaintainersLiveOpen = maintainersLiveOpen;
  window.bynkAct = act;
  window.bynkMetrics = metrics;
  window.bynkRepoMark = repoMark;

  document.addEventListener("DOMContentLoaded", () => {
    if (location.pathname === CALLBACK) finish();
    else {
      renderLink();
      loadRepositories();
      loadMine();
      setInterval(() => { if (!document.hidden) loadMine(); }, MINE_EVERY_MS);
    }
  });
})();
