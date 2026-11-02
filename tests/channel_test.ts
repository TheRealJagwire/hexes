import { assert, assertEquals } from "@std/assert";
import { type ChannelEvent, HexesChannel, sendsOf } from "../src/mcp/channel.ts";
import {
  ChannelPresence,
  CHANNELS_DIR,
  readChannels,
  STALE_MS,
} from "../src/server/core/channels.ts";
import type { HexService } from "../src/server/core/service.ts";
import { ChangeWatcher } from "../src/server/core/watcher.ts";
import { type Fixture, fixture } from "./helpers.ts";

function design(s: HexService, projectId: string, title: string) {
  return s.createHex({
    projectId,
    kind: "core.design",
    title,
    description: "",
    status: "blocked",
    requiredBy: [],
    dependsOn: [projectId],
    meta: {},
  });
}

/** A started channel over the fixture's workspace that collects what it sends. */
async function channel(f: Fixture) {
  const sent: ChannelEvent[] = [];
  const watcher = new ChangeWatcher(f.workspace, 10, 200);
  const ch = new HexesChannel({
    workspace: f.workspace,
    watcher,
    send: (e) => {
      sent.push(e);
    },
    settleMs: 20,
  });
  await ch.start();
  /** Waits until `n` events have been sent, then a little longer to catch any extra. */
  const waitFor = async (n: number, ms = 3000) => {
    const end = Date.now() + ms;
    while (sent.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 300));
    await ch.idle();
    return sent.length >= n;
  };
  return { ch, sent, waitFor };
}

Deno.test("blessing a design sends one event", async () => {
  const f = await fixture();
  const d = await design(f.service, f.projectId, "Wake the agent");
  const { ch, sent, waitFor } = await channel(f);
  try {
    await f.service.updateHex(d.id, { status: "blessed" });
    assert(await waitFor(1), "no event");
    assertEquals(sent.length, 1);
    assertEquals(sent[0]!.meta.project, f.projectId);
    assertEquals(sent[0]!.meta.blessed, d.id);
    assert(sent[0]!.content.startsWith(`Blessed: design ${d.id} "Wake the agent"`));
  } finally {
    ch.stop();
    await f.cleanup();
  }
});

Deno.test("publishing an idea sends one event", async () => {
  const f = await fixture();
  const idea = await f.service.createHex({
    projectId: f.projectId,
    kind: "core.idea",
    title: "Hex rivers",
    description: "",
    status: "draft",
    requiredBy: [],
    dependsOn: [f.projectId],
    meta: {},
  });
  const { ch, sent, waitFor } = await channel(f);
  try {
    await f.service.updateHex(idea.id, { status: "published" });
    assert(await waitFor(1), "no event");
    assertEquals(sent.length, 1);
    assertEquals(sent[0]!.meta.published, idea.id);
    assert(sent[0]!.content.startsWith(`Published: idea ${idea.id} "Hex rivers"`));
  } finally {
    ch.stop();
    await f.cleanup();
  }
});

Deno.test("two blessings inside the settle window send one event", async () => {
  const f = await fixture();
  const a = await design(f.service, f.projectId, "A");
  const b = await design(f.service, f.projectId, "B");
  const { ch, sent, waitFor } = await channel(f);
  try {
    await f.service.updateHex(a.id, { status: "blessed" });
    await f.service.updateHex(b.id, { status: "blessed" });
    assert(await waitFor(1), "no event");
    assertEquals(sent.length, 1);
    assertEquals(sent[0]!.meta.blessed, `${a.id},${b.id}`);
  } finally {
    ch.stop();
    await f.cleanup();
  }
});

Deno.test("starting does not replay earlier blessings", async () => {
  const f = await fixture();
  const d = await design(f.service, f.projectId, "Old");
  await f.service.updateHex(d.id, { status: "blessed" });
  const { ch, sent, waitFor } = await channel(f);
  try {
    await f.service.updateHex(f.projectId, { title: "Renamed" });
    await waitFor(1, 400);
    assertEquals(sent, []);
  } finally {
    ch.stop();
    await f.cleanup();
  }
});

Deno.test("switching workspace re-baselines without sending", async () => {
  const f = await fixture();
  const second = await f.service.createProject({
    dir: `${f.dir}-b`,
    title: "Second",
    description: "",
    gitInit: false,
  });
  const old = await design(f.service, second.projectId!, "Blessed before the channel saw it");
  await f.service.updateHex(old.id, { status: "blessed" });
  await f.workspace.open(f.dir);
  const { ch, sent, waitFor } = await channel(f);
  try {
    await f.workspace.open(`${f.dir}-b`);
    await waitFor(1, 400);
    assertEquals(sent, [], "a switch is not news");

    const fresh = await design(f.service, second.projectId!, "Fresh");
    await f.service.updateHex(fresh.id, { status: "blessed" });
    assert(await waitFor(1), "no event in the new workspace");
    assertEquals(sent.map((s) => s.meta.blessed), [fresh.id]);
  } finally {
    ch.stop();
    await Deno.remove(`${f.dir}-b`, { recursive: true });
    await f.cleanup();
  }
});

Deno.test("stop() unsubscribes", async () => {
  const f = await fixture();
  const d = await design(f.service, f.projectId, "Late");
  const { ch, sent, waitFor } = await channel(f);
  ch.stop();
  try {
    await f.service.updateHex(d.id, { status: "blessed" });
    await waitFor(1, 400);
    assertEquals(sent, []);
  } finally {
    await f.cleanup();
  }
});

Deno.test("a channel's presence file is written, refreshed, records sends and goes on stop", async () => {
  const f = await fixture();
  const d = await design(f.service, f.projectId, "Say you heard");
  let now = 1_000;
  const presence = new ChannelPresence(f.workspace, 4242, () => now, 30);
  const sent: ChannelEvent[] = [];
  const ch = new HexesChannel({
    workspace: f.workspace,
    watcher: new ChangeWatcher(f.workspace, 10, 200),
    send: (e) => {
      sent.push(e);
    },
    presence,
    settleMs: 20,
  });
  const file = `${f.dir}/${CHANNELS_DIR}/4242.json`;
  const read = async () => JSON.parse(await Deno.readTextFile(file));
  try {
    await ch.start();
    await presence.start();
    assertEquals(await read(), { pid: 4242, startedAt: 1000, heartbeatAt: 1000, sent: [] });
    assertEquals((await readChannels(f.dir, 1000)).map((c) => c.pid), [4242]);

    now = 2_000; // the heartbeat refreshes it
    const end = Date.now() + 2000;
    while ((await read()).heartbeatAt !== 2000 && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assertEquals((await read()).heartbeatAt, 2000);

    now = 3_000;
    await f.service.updateHex(d.id, { status: "blessed" });
    const until = Date.now() + 3000;
    while ((await read()).sent.length === 0 && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assertEquals(sent.length, 1);
    assertEquals((await read()).sent, [{ hexId: d.id, event: "blessed", at: 3000 }]);

    // Older than 45 s without a heartbeat: gone, as after a kill -9.
    assertEquals(await readChannels(f.dir, 3_000 + STALE_MS + 1), []);
  } finally {
    ch.stop();
    await presence.stop();
  }
  try {
    assertEquals(await Deno.stat(file).then(() => true, () => false), false);
    assertEquals(await readChannels(f.dir), []);
  } finally {
    await f.cleanup();
  }
});

Deno.test("sendsOf names each published, blessed and answered hex", () => {
  assertEquals(
    sendsOf({ content: "", meta: { project: "p", blessed: "a,b", answered: "q", ready: "x" } }),
    [{ hexId: "a", event: "blessed" }, { hexId: "b", event: "blessed" }, {
      hexId: "q",
      event: "answered",
    }],
  );
});
