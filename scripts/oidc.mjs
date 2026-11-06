// Phase 4, slice 6 (#53): the maintainer sign-in's token check, end to end,
// against a running Worker (`bynk dev`). It serves a fake OIDC issuer's JWKS on
// localhost, and the Worker must be started trusting it through
// `MAINTAINER_OIDC` (the `Maintainer` actor's `trustFrom`):
//
//   bynk dev -- --var 'MAINTAINER_OIDC:{"issuer":"http://localhost:9999/oidc/test-client","jwks":"http://localhost:9999/oidc/test-client/jwks","audience":"test-client"}'
//   node scripts/oidc.mjs
//
// Then it checks what Bynk's `Oidc` verification and `/maintainers/me` do with
// tokens signed by that issuer, and with forged, mistargeted and expired ones.
//
// Run it against a freshly started Worker. Each run makes a new key, and the
// Worker refetches the JWKS for an unknown key id at most every 30 seconds
// (Bynk's cooldown against forged key ids), so a second run soon after the
// first sees its valid tokens refused.
import { createServer } from "node:http";
import { generateKeyPairSync, createSign } from "node:crypto";

const WORKER = process.env.WORKER_URL || "http://localhost:8787";
const PORT = 9999;
const ISSUER = `http://localhost:${PORT}/oidc/test-client`;
const AUDIENCE = "test-client";

const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
// A fresh key id each run: the Worker caches the JWKS for 10 minutes, and
// refetches it on an unknown key id, so an earlier run's key never lingers.
const KID = `test-key-${Date.now()}`;
const jwk = { ...key.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };

const server = createServer((req, res) => {
  if (req.url === "/oidc/test-client/jwks") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function token(claims, { signer = key.privateKey, kid = KID } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", typ: "JWT", kid });
  const body = b64({ iss: ISSUER, aud: AUDIENCE, sub: "access-user-1", iat: now, exp: now + 600, ...claims });
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(signer).toString("base64url");
  return `${head}.${body}.${sig}`;
}

async function me(bearer) {
  const res = await fetch(`${WORKER}/maintainers/me`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
  return { status: res.status, body: await res.text() };
}

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` (${detail})`}`);
  if (!ok) failed += 1;
}

server.listen(PORT, async () => {
  try {
    const none = await me(null);
    check("no token is refused", none.status === 401, none.status);
    const forged = await me(token({ login: "accuser" }, { signer: stranger.privateKey }));
    check("a token signed by another key is refused", forged.status === 401, forged.status);
    const elsewhere = await me(token({ login: "accuser", aud: "another-app" }));
    check("a token for another audience is refused", elsewhere.status === 401, elsewhere.status);
    // Bynk allows 60 seconds of clock skew on `exp` and `nbf`; this is well past it.
    const expired = await me(token({ login: "accuser", exp: Math.floor(Date.now() / 1000) - 300 }));
    check("an expired token is refused", expired.status === 401, expired.status);
    const nameless = await me(token({ email: "accuser@example.com" }));
    check(
      "a valid token with no GitHub login is refused, naming the claims it carried",
      nameless.status === 403 && nameless.body.includes("no_login") && nameless.body.includes("present: email"),
      `${nameless.status} ${nameless.body}`
    );
    // Past the token check, the Worker asks GitHub whether they belong to the
    // organisation, which a local Worker can't (no App key, or no installation
    // recorded): it answers that it can't tell, not that they're refused.
    const valid = await me(token({ login: "accuser" }));
    check(
      "a valid token with a login passes the token check and reaches the membership check",
      valid.status === 200 || valid.status === 503,
      `${valid.status} ${valid.body}`
    );
  } catch (e) {
    check("the Worker answered", false, e.message);
  }
  server.close();
  process.exit(failed > 0 ? 1 : 0);
});
