import { assert, assertEquals } from "@std/assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/build.ts";
import { createApp } from "../src/server/app.ts";
import { ActivityLog, hexIdOf, WORKING_MS } from "../src/server/core/activity.ts";
import { ChangeWatcher } from "../src/server/core/watcher.ts";
import { fixture } from "./helpers.ts";

Deno.test("tool calls are recorded with the hex they were about", async () => {
  const f = await fixture();
  const activity = new ActivityLog();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await buildServer(f.service, activity).connect(serverT);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientT);
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  try {
    await call("list_projects", {});
    assertEquals(activity.forProject(f.projectId).lastCall?.tool, "list_projects");
    assertEquals(activity.forProject(f.projectId).working, null);

    await call("get_project", { project_id: f.projectId });
    const created = await call("create_hex", {
      project_id: f.projectId,
      kind: "core.design",
      title: "Board",
      depends_on: [f.projectId],
    });
    const id = JSON.parse((created.content as { text: string }[])[0]!.text).id as string;
    const a = activity.forProject(f.projectId);
    assertEquals([a.lastCall?.tool, a.lastCall?.hexId, a.lastCall?.read], [
      "create_hex",
      id,
      false,
    ]);
    assertEquals([a.working?.hexId, a.working?.tool], [id, "create_hex"]);

    // A read afterwards is the latest call but doesn't move the working hex.
    await call("get_hex_by_id", { id: f.projectId });
    const b = activity.forProject(f.projectId);
    assertEquals([b.lastCall?.tool, b.working?.hexId], ["get_hex_by_id", id]);

    // A refused call still counts as the agent being there.
    await call("update_hex_status", { id, status: "ready" });
    assertEquals(activity.forProject(f.projectId).lastCall?.tool, "update_hex_status");

    // Another project's calls don't show here.
    assertEquals(activity.forProject("hx-other-abc").working, null);
  } finally {
    await client.close();
    await f.cleanup();
  }
});

Deno.test("the working hex is the latest changed one in the last ten minutes", () => {
  let now = 0;
  const log = new ActivityLog(() => now);
  const P = "hx-demo-aaa";
  log.record({ tool: "start_work_branch", read: false, hexId: "hx-demo-bbb" });
  now = 1000;
  log.record({ tool: "update_hex", read: false, hexId: "hx-demo-ccc" });
  now = 2000;
  log.record({ tool: "get_hex_view", read: true, hexId: "hx-demo-bbb" });
  log.record({ tool: "update_hex", read: false, hexId: "hx-else-ddd" });
  assertEquals(log.forProject(P).working, { hexId: "hx-demo-ccc", tool: "update_hex", at: 1000 });
  now = 1000 + WORKING_MS + 1;
  assertEquals(log.forProject(P).working, null);
  assertEquals(log.forProject(P).lastCall?.tool, "get_hex_view");
});

Deno.test("hexIdOf prefers the id argument, then the result, then project_id", () => {
  assertEquals(hexIdOf({ id: "hx-a-111" }, { id: "hx-a-222" }), "hx-a-111");
  assertEquals(hexIdOf({ project_id: "hx-a-111" }, { id: "hx-a-222" }), "hx-a-222");
  assertEquals(hexIdOf({ project_id: "hx-a-111" }, [{ id: "hx-a-333" }]), "hx-a-111");
  assertEquals(hexIdOf({}, undefined), null);
  assertEquals(hexIdOf({ id: "not an id" }, null), null);
});

Deno.test("calls over /mcp show at /api/agent and stream as one agent event a second", async () => {
  const f = await fixture();
  const activity = new ActivityLog(Date.now, 50);
  const app = createApp(f.service, new ChangeWatcher(f.workspace, 20, 200), {}, activity);
  const H = { host: "localhost:8000" };
  const res = await app.request("/api/events", { headers: H });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const read = async (needle: string) => {
    const end = Date.now() + 4000;
    while (!seen.includes(needle) && Date.now() < end) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += decoder.decode(value);
    }
    return seen.includes(needle);
  };
  const mcp = (id: number, method: string, params: unknown) =>
    app.request("/mcp", {
      method: "POST",
      headers: {
        ...H,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
  try {
    assert(await read("event: hello"), seen);
    const call = await mcp(1, "tools/call", {
      name: "get_project",
      arguments: { project_id: f.projectId },
    });
    assertEquals(call.status, 200, await call.clone().text());
    assert(await read("event: agent"), seen);
    assert(seen.includes('"tool":"get_project"'), seen);
    const now = await app.request(`/api/agent?project=${f.projectId}`, { headers: H });
    assertEquals((await now.json()).lastCall.tool, "get_project");
    assertEquals((await app.request("/api/agent", { headers: H })).status, 400);
  } finally {
    await reader.cancel();
    await f.cleanup();
  }
});
