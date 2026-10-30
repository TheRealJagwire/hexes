import { assert, assertEquals } from "@std/assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/build.ts";
import { fixture } from "./helpers.ts";

async function connect(f: Awaited<ReturnType<typeof fixture>>) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await buildServer(f.service).connect(serverT);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientT);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const content = res.content as { type: string; text: string }[];
    const body = content[0]?.text ?? "";
    return { isError: res.isError === true, body, json: res.isError ? null : JSON.parse(body) };
  };
  return { client, call };
}

Deno.test("mcp exposes the spec'd tools and they work end to end", async () => {
  const f = await fixture();
  const { client, call } = await connect(f);
  try {
    const names = (await client.listTools()).tools.map((t: { name: string }) => t.name);
    for (
      const n of [
        "get_hex_by_id",
        "get_ready_hexes",
        "get_ready_hexes_for_project",
        "get_hexes_that_depend_on_hex_with_id",
        "get_hexes_that_this_hex_depends_on",
        "add_meta_state_to_hex_with_id",
        "update_meta_state_to_hex_with_id",
      ]
    ) assert(names.includes(n), `missing ${n}`);

    const story = (await call("create_hex", {
      project_id: f.projectId,
      kind: "core.story",
      title: "Ship",
      status: "ready",
    })).json;
    assertEquals(
      (await call("get_ready_hexes_for_project", { project_id: f.projectId })).json.length,
      1,
    );
    assertEquals((await call("get_hex_by_id", { id: story.id })).json.title, "Ship");
    assertEquals(
      (await call("add_meta_state_to_hex_with_id", { id: story.id, key: "k", value: "v" })).json
        .meta,
      { k: "v" },
    );
    assert(
      (await call("add_meta_state_to_hex_with_id", { id: story.id, key: "k", value: "v" })).isError,
    );
    assertEquals(
      (await call("update_meta_state_to_hex_with_id", { id: story.id, key: "k", value: "w" })).json
        .meta,
      { k: "w" },
    );

    const epic = (await call("create_hex", {
      project_id: f.projectId,
      kind: "core.epic",
      title: "Epic",
      depends_on: [story.id],
    })).json;
    assertEquals(
      (await call("get_hexes_that_depend_on_hex_with_id", { id: story.id })).json[0].id,
      epic.id,
    );
    assertEquals(
      (await call("get_hexes_that_this_hex_depends_on", { id: epic.id })).json[0].id,
      story.id,
    );
    await call("update_hex_status", { id: story.id, status: "done" });
    assertEquals((await call("get_hex_by_id", { id: epic.id })).json.status, "ready");

    assert(
      (await call("delete_hex", { id: story.id, confirm: false })).isError,
      "needs confirm=true",
    );
    assertEquals((await call("delete_hex", { id: story.id, confirm: true })).json.deleted, [
      story.id,
    ]);
    assert((await call("get_hex_by_id", { id: story.id })).isError);
  } finally {
    await client.close();
    await f.cleanup();
  }
});

Deno.test("mcp is served over HTTP from the Studio app", async () => {
  const f = await fixture();
  const { createApp } = await import("../src/server/app.ts");
  const app = createApp(f.service);
  const post = (body: unknown) =>
    app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "localhost:8000",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    });
  const init = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "t", version: "0" },
    },
  });
  assertEquals(init.status, 200);
  const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const json = await list.json();
  assert(json.result.tools.some((t: { name: string }) => t.name === "get_workspace"));
});

Deno.test("mcp answers questions with a response and leaves blessing to people", async () => {
  const f = await fixture();
  const { client, call } = await connect(f);
  try {
    const design = (await call("create_hex", {
      project_id: f.projectId,
      kind: "core.design",
      title: "Design",
    })).json;
    const blessed = await call("update_hex_status", { id: design.id, status: "blessed" });
    assert(blessed.isError && blessed.body.includes("Only a person"), blessed.body);
    const born = await call("create_hex", {
      project_id: f.projectId,
      kind: "core.design",
      title: "Pre-blessed",
      status: "blessed",
    });
    assert(born.isError && born.body.includes("Only a person"), born.body);

    const q = (await call("create_hex", {
      project_id: f.projectId,
      kind: "core.question",
      title: "Which?",
      status: "ready",
    })).json;
    const bare = await call("update_hex_status", { id: q.id, status: "answered" });
    assert(bare.isError && bare.body.includes("needs a response"), bare.body);
    const answered = (await call("update_hex_status", {
      id: q.id,
      status: "answered",
      response: "This one.",
    })).json;
    assertEquals(answered.status, "answered");
    const decision = (await call("get_hex_by_id", { id: answered.meta.decision })).json;
    assertEquals([decision.kind, decision.emergedFrom], ["core.decision", q.id]);
  } finally {
    await client.close();
    await f.cleanup();
  }
});

Deno.test("mcp reads and builds on ideas but never writes or moves one", async () => {
  const f = await fixture();
  const { client, call } = await connect(f);
  try {
    const s = f.service;
    const base = { description: "", requiredBy: [], meta: {}, projectId: f.projectId };
    const idea = await s.createHex({
      ...base,
      kind: "core.idea",
      title: "Hex rivers",
      status: "draft",
      dependsOn: [f.projectId],
    });
    const refused = (r: { isError: boolean; body: string }, text: string) =>
      assert(r.isError && r.body.includes(text), r.body);
    const belongs = "Ideas belong to people";

    refused(
      await call("create_hex", { project_id: f.projectId, kind: "core.idea", title: "Mine" }),
      "Ideas come from people",
    );
    for (const status of ["draft", "published"]) {
      refused(await call("update_hex_status", { id: idea.id, status }), "Only a person");
    }
    refused(await call("update_hex_status", { id: idea.id, status: "done" }), belongs);
    refused(await call("update_hex", { id: idea.id, title: "Better rivers" }), belongs);
    refused(await call("delete_hex", { id: idea.id, confirm: true }), belongs);
    refused(
      await call("add_dependency", { id: idea.id, depends_on_id: f.projectId }),
      belongs,
    );
    refused(
      await call("remove_dependency", { id: idea.id, depends_on_id: f.projectId }),
      belongs,
    );
    refused(
      await call("add_meta_state_to_hex_with_id", { id: idea.id, key: "k", value: "v" }),
      belongs,
    );
    refused(
      await call("update_meta_state_to_hex_with_id", { id: idea.id, key: "k", value: "v" }),
      belongs,
    );
    refused(await call("remove_meta_state_from_hex_with_id", { id: idea.id, key: "k" }), belongs);
    refused(
      await call("create_hex", {
        project_id: f.projectId,
        kind: "core.story",
        title: "Sneaky",
        required_by: [idea.id],
      }),
      belongs,
    );
    const story = (await call("create_hex", {
      project_id: f.projectId,
      kind: "core.story",
      title: "Story",
    })).json;
    refused(await call("update_hex_status", { id: story.id, status: "draft" }), "Only a person");
    assertEquals((await s.getHex(idea.id)).title, "Hex rivers", "the idea is untouched");

    // Reading, building on and linking to an idea is fine.
    await s.updateHex(idea.id, { status: "published" });
    const ready = (await call("get_ready_hexes_for_project", { project_id: f.projectId })).json;
    assertEquals(ready.map((h: { id: string }) => h.id), [idea.id]);
    assertEquals((await call("get_hex_view", { id: idea.id })).json.hex.status, "published");
    const design = (await call("create_hex", {
      project_id: f.projectId,
      kind: "core.design",
      title: "Design rivers",
      status: "in_progress",
      depends_on: [f.projectId, idea.id],
      emerged_from: idea.id,
    })).json;
    assertEquals(design.dependsOn, [f.projectId, idea.id]);
    assert(!(await call("add_dependency", { id: story.id, depends_on_id: idea.id })).isError);

    // Deleting the whole project still takes its ideas with it.
    const gone = await call("delete_hex", { id: f.projectId, confirm: true });
    assert(gone.json.deleted.includes(idea.id), gone.body);
  } finally {
    await client.close();
    await f.cleanup();
  }
});

Deno.test("mcp writes facts: known by default, retired and restored by agents", async () => {
  const f = await fixture();
  const { client, call } = await connect(f);
  try {
    const made = await call("create_hex", {
      project_id: f.projectId,
      kind: "core.fact",
      title: "Channels must be stdio",
      depends_on: [f.projectId],
      meta: { files: "src/mcp/channel.ts" },
    });
    assert(!made.isError, made.body);
    assertEquals(made.json.status, "known");
    // Other kinds still default to blocked.
    const story = await call("create_hex", {
      project_id: f.projectId,
      kind: "core.story",
      title: "S",
    });
    assertEquals(story.json.status, "blocked");

    const retired = await call("update_hex_status", { id: made.json.id, status: "retired" });
    assertEquals(retired.json.status, "retired");
    const meta = await call("add_meta_state_to_hex_with_id", {
      id: made.json.id,
      key: "superseded_by",
      value: story.json.id,
    });
    assert(!meta.isError, meta.body);
    assertEquals(
      (await call("update_hex_status", { id: made.json.id, status: "known" })).json.status,
      "known",
    );

    const refused = await call("create_hex", {
      project_id: f.projectId,
      kind: "core.fact",
      title: "x",
      status: "retired",
    });
    assert(refused.isError && refused.body.includes("starts as known"), refused.body);
  } finally {
    await client.close();
    await f.cleanup();
  }
});

Deno.test("mcp get_facts finds the facts near a hex", async () => {
  const f = await fixture();
  const { client, call } = await connect(f);
  try {
    const design = await call("create_hex", {
      project_id: f.projectId,
      kind: "core.design",
      title: "D",
      depends_on: [f.projectId],
    });
    const fact = await call("create_hex", {
      project_id: f.projectId,
      kind: "core.fact",
      title: "Channels must be stdio",
      depends_on: [f.projectId, design.json.id],
    });
    const got = await call("get_facts", { project_id: f.projectId, near: design.json.id });
    assert(!got.isError, got.body);
    assertEquals(got.json.facts.map((h: { fact: { id: string } }) => h.fact.id), [fact.json.id]);
    assertEquals(got.json.facts[0].path.map((p: { id: string }) => p.id), [
      design.json.id,
      fact.json.id,
    ]);
    const bad = await call("get_facts", { project_id: f.projectId, depth: 7 });
    assert(bad.isError);
  } finally {
    await client.close();
    await f.cleanup();
  }
});
