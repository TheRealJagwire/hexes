import { assert, assertEquals } from "@std/assert";
import { createApp } from "../src/server/app.ts";
import { ChangeWatcher } from "../src/server/core/watcher.ts";
import { fixture } from "./helpers.ts";

const TOKEN = "correct-horse-battery-staple";
const phone = { remoteAddr: { hostname: "100.64.0.7" } };
const self = { remoteAddr: { hostname: "127.0.0.1" } };

async function appWith(security: { token?: string; allowedHosts?: string[] }) {
  const f = await fixture();
  const app = createApp(f.service, new ChangeWatcher(f.workspace), security);
  return { f, app };
}

Deno.test("remote peers are refused unless a token is configured", async () => {
  const { f, app } = await appWith({});
  try {
    const res = await app.request("/api/health", { headers: { host: "mac.tail.ts.net" } }, phone);
    assertEquals(res.status, 403);
    // spoofing a loopback Host from a remote peer does not help either
    const spoof = await app.request("/api/health", { headers: { host: "localhost:8000" } }, phone);
    assertEquals(spoof.status, 403);
  } finally {
    await f.cleanup();
  }
});

Deno.test("remote peers need the bearer token, loopback peers do not", async () => {
  const { f, app } = await appWith({ token: TOKEN, allowedHosts: ["mac.tail.ts.net"] });
  const host = "mac.tail.ts.net:8000";
  try {
    assertEquals((await app.request("/api/health", { headers: { host } }, phone)).status, 401);
    const wrong = { host, authorization: "Bearer nope-nope-nope-nope" };
    assertEquals((await app.request("/api/health", { headers: wrong }, phone)).status, 401);
    const ok = { host, authorization: `Bearer ${TOKEN}` };
    const res = await app.request("/api/health", { headers: ok }, phone);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("x-hexes-api"), "1");
    // a host outside the allow-list is refused even with the token
    const other = { host: "evil.com", authorization: `Bearer ${TOKEN}` };
    assertEquals((await app.request("/api/health", { headers: other }, phone)).status, 403);
    // the local browser needs no token, but still only with a loopback Host
    assertEquals(
      (await app.request("/api/health", { headers: { host: "localhost:8000" } }, self)).status,
      200,
    );
    assertEquals(
      (await app.request("/api/health", { headers: { host: "evil.com" } }, self)).status,
      403,
    );
    // the same rules cover MCP
    assertEquals(
      (await app.request("/mcp", { method: "POST", headers: { host } }, phone)).status,
      401,
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("remote writes still have to be JSON", async () => {
  const { f, app } = await appWith({ token: TOKEN });
  try {
    const res = await app.request("/api/selected-project", {
      method: "POST",
      headers: { host: "x.local", authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" },
      body: JSON.stringify({ id: f.projectId }),
    }, phone);
    assertEquals(res.status, 415);
  } finally {
    await f.cleanup();
  }
});

Deno.test("recent workspaces are listed, most recent first, and flag missing ones", async () => {
  const f = await fixture();
  try {
    const second = `${f.dir}-b`;
    await f.service.createProject({ dir: second, title: "B", description: "", gitInit: false });
    let recent = await f.service.recentWorkspaces();
    assertEquals(recent.map((r) => r.dir), [second, f.dir]);
    assertEquals(recent[0]?.label, "proj-b");
    assert(recent.every((r) => r.found));
    await Deno.remove(second, { recursive: true });
    recent = await f.service.recentWorkspaces();
    assertEquals(recent[0]?.found, false);
  } finally {
    await f.cleanup();
  }
});

Deno.test("an edit made against a stale version is refused", async () => {
  const f = await fixture();
  try {
    const hex = await f.service.updateHex(f.projectId, { title: "One" });
    const stale = hex.lastUpdatedAtTimeInMs - 1;
    const err = await f.service.updateHex(f.projectId, {
      title: "Two",
      expectedUpdatedAtTimeInMs: stale,
    }).catch((e) => e);
    assertEquals(err.status, 409);
    const ok = await f.service.updateHex(f.projectId, {
      title: "Two",
      expectedUpdatedAtTimeInMs: hex.lastUpdatedAtTimeInMs,
    });
    assertEquals(ok.title, "Two");
  } finally {
    await f.cleanup();
  }
});
