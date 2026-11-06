// Signing maintainers in (#53), shared by every page. A maintainer signs in
// with GitHub, through the GitHub App's user authorisation, with the
// authorisation-code flow and PKCE. The page hands the code and its verifier
// to the Worker (`POST /maintainers/token`), which exchanges them with the
// App's client secret, checks the person belongs to the organisation, and
// answers its own token for them. That token is kept in `sessionStorage`, so
// it lasts as long as the tab, and sent as `Authorization: Bearer` to the
// maintainer routes. Other scripts read the signed-in maintainer from
// `window.bynkMaintainer`.
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

  window.bynkMaintainer = current;

  document.addEventListener("DOMContentLoaded", () => {
    if (location.pathname === CALLBACK) finish();
    else renderLink();
  });
})();
