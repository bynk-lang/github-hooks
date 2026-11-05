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
import { createHmac, randomUUID } from "node:crypto";
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

function open() {
  return new Promise((resolve) => {
    const url = `${base.replace(/^http/, "ws")}/live?board=ci&client=${randomUUID()}`;
    const ws = new WebSocket(url);
    const seen = [];
    ws.onmessage = (m) => seen.push(JSON.parse(m.data));
    ws.onopen = () => resolve({ ws, seen, opened: true });
    ws.onerror = () => resolve({ ws, seen, opened: false });
  });
}

async function deliver(runId) {
  const body = fixture.replace('"id": 41978704067', `"id": ${runId}`);
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
process.exit(failed);
