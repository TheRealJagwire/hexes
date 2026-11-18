import { assert, assertEquals } from "@std/assert";
import { createApp } from "../src/server/app.ts";
import { ChannelPresence, readChannels } from "../src/server/core/channels.ts";
import { HexFile } from "../src/server/core/store.ts";
import { type ChangeEvent, ChangeWatcher } from "../src/server/core/watcher.ts";
import { type Fixture, fixture } from "./helpers.ts";

function collect(w: ChangeWatcher) {
  const events: ChangeEvent[] = [];
  const stop = w.subscribe((e) => events.push(e));
  const waitFor = async (n: number, ms = 3000) => {
    const end = Date.now() + ms;
    while (events.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    return events.length >= n;
  };
  return { events, stop, waitFor };
}

Deno.test("watcher reports every write, including repeated rename-over-replace", async () => {
  const f = await fixture();
  const w = new ChangeWatcher(f.workspace, 20, 200);
  const { events, stop, waitFor } = collect(w);
  try {
    await w.snapshot();
    const other = new HexFile(f.dir); // a second instance, like another process would use
    for (let i = 1; i <= 3; i++) {
      await other.mutate((hexes) => {
        const p = hexes.find((h) => h.id === f.projectId)!;
        p.title = `renamed ${i}`;
      });
      assert(await waitFor(i), `no event for write ${i}`);
    }
    assertEquals(events.map((e) => e.scope), ["data", "data", "data"]);
    assertEquals(events.map((e) => e.rev), [1, 2, 3]);
    assertEquals(events[0]?.dir, `${f.dir}/.hx`);
  } finally {
    stop();
    await f.cleanup();
  }
});

Deno.test("GET /api/events streams hello, then change when a hex is updated", async () => {
  const f = await fixture();
  const watcher = new ChangeWatcher(f.workspace, 20, 200);
  const app = createApp(f.service, watcher);
  const res = await app.request("/api/events", { headers: { host: "localhost:8000" } });
  assertEquals(res.headers.get("content-type")?.startsWith("text/event-stream"), true);
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
  try {
    assert(await read("event: hello"), seen);
    await f.service.updateHex(f.projectId, { title: "Live title" });
    assert(await read("event: change"), seen);
  } finally {
    await reader.cancel();
    await f.cleanup();
  }
});

Deno.test("a channel heartbeat is a channels change, streamed as a channel event", async () => {
  const f = await fixture();
  const watcher = new ChangeWatcher(f.workspace, 20, 200);
  const { events, stop, waitFor } = collect(watcher);
  const app = createApp(f.service, watcher);
  const H = { headers: { host: "localhost:8000" } };
  const res = await app.request("/api/events", H);
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
  const presence = new ChannelPresence(f.workspace, 777, Date.now, 60_000, f.projectId);
  try {
    assert(await read("event: hello"), seen);
    await watcher.snapshot();
    await presence.start();
    assert(await waitFor(1), "no channels event");
    assertEquals(events.map((e) => e.scope), ["channels"]);
    assert(await read("event: channel"), seen);
    assert(seen.includes('"pid":777'), seen);
    assert(!seen.includes("event: change"), seen);
    const now = await app.request("/api/channels", H);
    assertEquals((await now.json()).channels.map((c: { pid: number }) => c.pid), [777]);
  } finally {
    await presence.stop();
    stop();
    await reader.cancel();
    await f.cleanup();
  }
});

/** Seeds a schema-v2 project straight into the fixture's ~/.hx stand-in. */
async function seedV2(f: Fixture, id: string): Promise<void> {
  await f.workspace.projects.file(id).mutate((hexes) => {
    hexes.push({
      id,
      title: id,
      description: "",
      kind: "core.project",
      status: "done",
      createdAtTimeInMs: 1,
      lastUpdatedAtTimeInMs: 1,
      meta: { schema_version: "2", repo_path: f.dir },
    });
  }, { create: true });
}

Deno.test("the watcher follows every v2 project", async () => {
  const f = await fixture("Hexes Studio", { v2: true });
  await seedV2(f, "hx-vtwo-0a1");
  const w = new ChangeWatcher(f.workspace, 20, 200);
  const { events, stop, waitFor } = collect(w);
  const presence = new ChannelPresence(f.workspace, 991, Date.now, 60_000, "hx-vtwo-0a1");
  const v2Dir = f.workspace.projects.projectDir("hx-vtwo-0a1");
  try {
    await w.snapshot();

    // A write from another process, straight to a project's file.
    await f.workspace.projects.file("hx-vtwo-0a1").mutate((hexes) => {
      hexes[0]!.title = "renamed";
    });
    assert(await waitFor(1), "no event for the v2 write");
    assertEquals([events[0]?.scope, events[0]?.dir], ["data", v2Dir]);

    // A channel bound to that project registers in its folder.
    await presence.start();
    assert(await waitFor(2), "no channels event");
    assertEquals([events[1]?.scope, events[1]?.dir], ["channels", v2Dir]);
    assertEquals((await readChannels(v2Dir)).map((c) => c.pid), [991]);
    assertEquals(await readChannels(f.workspace.projects.projectDir(f.projectId)), []);

    // A new project's folder joins the watched set.
    await seedV2(f, "hx-other-0b2");
    assert(await waitFor(3), "no event for a new project");
    assertEquals(
      [events[2]?.scope, events[2]?.dir],
      ["workspace", f.workspace.projects.projectDir("hx-other-0b2")],
    );
  } finally {
    await presence.stop();
    stop();
    await f.cleanup();
  }
});
