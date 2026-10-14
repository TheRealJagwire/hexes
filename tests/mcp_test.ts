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
