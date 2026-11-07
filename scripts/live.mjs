#!/usr/bin/env node
// The live feed, end to end (#20, step 4): two dashboards connect over
// WebSocket, a signed `workflow_run` delivery arrives, and both must be sent
// the run within a few seconds; a dashboard that has closed must not be.
// Bynk suites can't drive a WebSocket yet, so this runs against a Worker.
//
//   APP_WEBHOOK_SECRET=… node scripts/live.mjs [base-url]
//
// It records a run of this repository's CI with a made-up id, so `smoke.sh`
// runs it only when SMOKE_LIVE=1 (CI's local Worker), not against production.
//
// With MAINTAINER_TOKEN_SECRET set (as the Worker has it), it also checks the
// maintainers' board (#68): a socket the board doesn't expect is closed; a
// maintainer, once `POST /maintainers/live` has checked them, hears a private
// repository's run that the public board doesn't; and signing out closes
// their socket. Their membership is seeded into `bynk dev`'s local D1, since
// the local Worker can't ask GitHub.
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const base = (process.argv[2] || "http://localhost:8787").replace(/\/$/, "");
const secret = process.env.APP_WEBHOOK_SECRET || "dev-secret";
const fixture = readFileSync(new URL("../fixtures/github/workflow_run.completed.json", import.meta.url), "utf8");
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open(board = "ci", client = randomUUID()) {
  return new Promise((resolve) => {
    const url = `${base.replace(/^http/, "ws")}/live?board=${board}&client=${client}`;
    const ws = new WebSocket(url);
    const seen = [];
    // "Closed" here means the server has closed it: a close frame arrived
    // (readyState 2) or the closing finished. A local Worker sends the frame
    // but never finishes the closing handshake, so `onclose` alone would
    // miss it.
    const socket = { ws, seen, opened: false, get closed() { return ws.readyState >= 2; } };
    ws.onmessage = (m) => seen.push(JSON.parse(m.data));
    ws.onopen = () => { socket.opened = true; resolve(socket); };
    ws.onerror = () => resolve(socket);
  });
}

async function deliver(runId, isPrivate = false) {
  let body = fixture.replace('"id": 41978704067', `"id": ${runId}`);
  if (isPrivate) body = body.replaceAll('"private": false', '"private": true').replaceAll("github-hooks", "secret-hooks");
  const res = await fetch(`${base}/github`, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-github-event": "workflow_run",
      "x-github-delivery": `smoke-live-${runId}`,
      "x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
    },
  });
  return res.status;
}

const a = await open();
const b = await open();
check(a.opened && b.opened, "two dashboards connect to the live feed");
const runId = Date.now();
check((await deliver(runId)) === 202, "a signed workflow_run delivery is recorded (202)");
await sleep(2000);
check(a.seen.some((e) => e.run_id === runId) && b.seen.some((e) => e.run_id === runId), "both dashboards are sent the run");
b.ws.close();
await sleep(500);
const second = runId + 1;
await deliver(second);
await sleep(2000);
check(a.seen.some((e) => e.run_id === second), "an open dashboard is sent the next run");
check(!b.seen.some((e) => e.run_id === second), "a closed dashboard is not");
a.ws.close();

if (process.env.MAINTAINER_TOKEN_SECRET) {
  const project = new URL("..", import.meta.url).pathname;
  const login = `smoke-live-${Date.now()}`;
  const token = execFileSync("bynk", ["token", "Maintainer", "--sub", login, "--lifetime", "5m", "--input", project], { encoding: "utf8" }).trim();
  // The local Worker can't ask GitHub, so it is told the login belongs, as a kept answer.
  execFileSync("npx", ["--yes", "wrangler", "d1", "execute", "github-hooks-deliveries", "--local", "--command",
    `INSERT INTO org_members (org, login, member, checked_at) VALUES ('bynk-lang', '${login}', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`],
    { cwd: `${project}.bynk/dev/workers/github-hooks`, stdio: "ignore" });
  const ask = (client, bearer) => fetch(`${base}/maintainers/live`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({ client }),
  }).then((r) => r.status);

  const stranger = await open("maintainers");
  await sleep(1000);
  check(stranger.closed, "a socket the maintainers' board doesn't expect is closed");
  check((await ask(randomUUID())) === 401, "joining the maintainers' board needs a maintainer's token");

  const client = randomUUID();
  check((await ask(client, token)) === 200, "a maintainer's page is expected on the maintainers' board");
  const mine = await open("maintainers", client);
  const pub = await open();
  await sleep(500);
  check(mine.opened && !mine.closed, "the expected socket joins the maintainers' board");
  const hidden = Date.now() + 7;
  check((await deliver(hidden, true)) === 202, "a private repository's run is recorded (202)");
  await sleep(2000);
  check(mine.seen.some((e) => e.run_id === hidden && e.repo === "bynk-lang/secret-hooks"), "the maintainer hears the private repository's run");
  check(!pub.seen.some((e) => e.run_id === hidden), "the public board doesn't");
  const out = await fetch(`${base}/maintainers/signout`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  check(out.status === 200, "the maintainer signs out");
  await sleep(1500);
  check(mine.closed, "signing out closes their socket on the maintainers' board");
  pub.ws.close();
}
process.exit(failed);
