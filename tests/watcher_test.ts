import { assert, assertEquals } from "@std/assert";
import { createApp } from "../src/server/app.ts";
import { ChannelPresence, readChannels } from "../src/server/core/channels.ts";
import { HexFile } from "../src/server/core/store.ts";
import { type ChangeEvent, ChangeWatcher } from "../src/server/core/watcher.ts";
import { type Fixture, fixture, legacyProject } from "./helpers.ts";

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

Deno.test("watcher notices the active directory switching", async () => {
  const f = await fixture();
  const w = new ChangeWatcher(f.workspace, 20, 200);
  const { events, stop, waitFor } = collect(w);
  try {
    await w.snapshot();
    const second = { projectId: await legacyProject(f.service, `${f.dir}-b`, "Second") };
    assert(second.projectId);
    assert(await waitFor(1), "no event for the switch");
    assertEquals(events[0]?.scope, "workspace");
    assertEquals(events[0]?.dir, `${f.dir}-b/.hx`);
    await Deno.remove(`${f.dir}-b`, { recursive: true });
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
  const presence = new ChannelPresence(f.workspace, 777);
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

Deno.test("for a v2 project, the watcher follows the selection, its data file and channels", async () => {
  const f = await fixture();
  await seedV2(f, "hx-vtwo-0a1");
  const w = new ChangeWatcher(f.workspace, 20, 200);
  const { events, stop, waitFor } = collect(w);
  const presence = new ChannelPresence(f.workspace, 991);
  const v2Dir = f.workspace.projects.projectDir("hx-vtwo-0a1");
  try {
    await w.snapshot();
    await f.service.selectProject("hx-vtwo-0a1");
    assert(await waitFor(1), "no event for selecting the v2 project");
    assertEquals([events[0]?.scope, events[0]?.dir], ["workspace", v2Dir]);

    // A write from another process, straight to the v2 file.
    await f.workspace.projects.file("hx-vtwo-0a1").mutate((hexes) => {
      hexes[0]!.title = "renamed";
    });
    assert(await waitFor(2), "no event for the v2 write");
    assertEquals([events[1]?.scope, events[1]?.dir], ["data", v2Dir]);

    // A channel registers in the v2 project's folder.
    await presence.start();
    assert(await waitFor(3), "no channels event");
    assertEquals(events[2]?.scope, "channels");
    assertEquals((await readChannels(v2Dir)).map((c) => c.pid), [991]);
    assertEquals(await readChannels(`${f.dir}/.hx`), []);
  } finally {
    await presence.stop();
    stop();
    await f.cleanup();
  }
});
