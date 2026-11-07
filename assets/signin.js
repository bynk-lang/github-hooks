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
  function signOut() {
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
  // public route's maintainer twin: POSTed, with the public query as JSON
  // and the token, over every repository, private and excluded ones too.
  // Signed out, from the public route, as before. A token the Worker refuses
  // (expired, or its holder has left the organisation) signs the page out,
  // and the public figures are fetched instead.
  async function metrics(path, query = {}) {
    const m = current();
    if (!m) {
      const pairs = Object.entries(query).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]);
      const qs = new URLSearchParams(pairs).toString();
      // Always ask the edge, never the browser's own copy: a live change
      // purges the edge, which the browser's cache wouldn't know about.
      const res = await fetch(`${path}${qs ? `?${qs}` : ""}`, { cache: "no-cache", headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(res.status === 429 ? "rate limited" : `HTTP ${res.status}`);
      return res.json();
    }
    const res = await fetch(`/maintainers${path}`, {
      method: "POST",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${m.token}` },
      body: JSON.stringify(query),
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
    shown = new Map();
    renderLink();
    document.dispatchEvent(new CustomEvent("bynk:repositories"));
  }

  window.bynkMaintainer = current;
  window.bynkMetrics = metrics;
  window.bynkRepoMark = repoMark;

  document.addEventListener("DOMContentLoaded", () => {
    if (location.pathname === CALLBACK) finish();
    else { renderLink(); loadRepositories(); }
  });
})();
