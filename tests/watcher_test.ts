import { assert, assertEquals } from "@std/assert";
import { createApp } from "../src/server/app.ts";
import { HexFile } from "../src/server/core/store.ts";
import { type ChangeEvent, ChangeWatcher } from "../src/server/core/watcher.ts";
import { fixture } from "./helpers.ts";

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
    assertEquals(events[0]?.dir, f.dir);
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
    const second = await f.service.createProject({
      dir: `${f.dir}-b`,
      title: "Second",
      description: "",
      gitInit: false,
    });
    assert(second.projectId);
    assert(await waitFor(1), "no event for the switch");
    assertEquals(events[0]?.scope, "workspace");
    assertEquals(events[0]?.dir, `${f.dir}-b`);
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
