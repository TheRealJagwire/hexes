import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/build.ts";
import { createApp } from "../src/server/app.ts";
import { DomainError } from "../src/server/core/errors.ts";
import { HexFile, ProjectStore } from "../src/server/core/store.ts";
import {
  allowedStatuses,
  roleOf,
  satisfies,
  SEED_DESCRIPTION_LIMIT,
  SEED_KIND,
  workflowOf,
} from "../src/shared/constants.ts";
import { isWorkKind, seedWarnings } from "../src/shared/graph.ts";
import { fixture } from "./helpers.ts";

Deno.test("a seed is available or retired, never blocked, and is not work", () => {
  assertEquals(allowedStatuses(SEED_KIND), ["available", "retired"]);
  assertEquals(workflowOf(SEED_KIND).promoteTo, null);
  assert(!allowedStatuses(SEED_KIND).includes("ready"));
  assertEquals([roleOf("available"), satisfies("available")], ["actionable", true]);
  assertEquals([roleOf("retired"), satisfies("retired")], ["terminal", false]);
  assertEquals(isWorkKind(SEED_KIND), false);
});

Deno.test("seeds live in <home>/seeds/data.json, apart from every project", async () => {
  const home = await Deno.makeTempDir({ prefix: "hexes-seeds-" });
  try {
    const store = new ProjectStore(home);
    assertEquals(store.seedsFile, `${home}/seeds/data.json`);
    assertEquals(store.seeds().path, store.seedsFile);
    await store.seeds().mutate((hexes) => {
      hexes.push({
        id: "hx-seed-0a1",
        title: "Deno app",
        description: "Deno + Hono.",
        kind: SEED_KIND,
        status: "available",
        createdAtTimeInMs: 1,
        lastUpdatedAtTimeInMs: 1,
        meta: { git_url: "https://example.com/deno-app.git" },
      });
    }, { create: true });
    assertEquals((await store.seeds().read()).map((h) => h.id), ["hx-seed-0a1"]);
    assertEquals(await store.list(), [], "seeds are not a project");
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("seedWarnings flags a long description and a missing git URL", () => {
  const ok = { description: "Short.", meta: { git_url: "/srv/seed.git" } };
  assertEquals(seedWarnings(ok), []);
  assertEquals(seedWarnings({ ...ok, description: "x".repeat(SEED_DESCRIPTION_LIMIT) }), []);
  assertEquals(seedWarnings({ ...ok, description: "x".repeat(SEED_DESCRIPTION_LIMIT + 1) }), [
    `description is over ${SEED_DESCRIPTION_LIMIT} characters`,
  ]);
  assertEquals(seedWarnings({ description: "Short." }), ["meta.git_url is missing"]);
});

Deno.test("seeds are created, listed, updated, retired and restored, apart from any project", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const a = await s.createSeed({
      title: "Deno app",
      description: "Deno + Hono + Preact. Tests and lint set up. Good for web apps.",
      gitUrl: "https://example.com/deno-app.git",
    });
    assert(a.hex.id.startsWith("hx-seed-"), a.hex.id);
    assertEquals([a.hex.status, a.gitUrl, a.branch, a.warnings], [
      "available",
      "https://example.com/deno-app.git",
      "main",
      [],
    ]);
    const b = await s.createSeed({
      title: "Long",
      description: "x".repeat(SEED_DESCRIPTION_LIMIT + 1),
      gitUrl: "/srv/long.git",
      branch: "trunk",
    });
    assertEquals([b.branch, b.warnings.length], ["trunk", 1]);

    // Not in the project's file.
    const project = await new HexFile(f.dir).read();
    assertEquals(project.some((h) => h.kind === SEED_KIND), false);

    const updated = await s.updateSeed(b.hex.id, { description: "Short now.", branch: "main" });
    assertEquals([updated.hex.description, updated.branch, updated.warnings], [
      "Short now.",
      "main",
      [],
    ]);

    await s.retireSeed(b.hex.id);
    assertEquals((await s.listSeeds()).map((x) => x.hex.id), [a.hex.id]);
    assertEquals((await s.listSeeds({ includeRetired: true })).length, 2);
    assertEquals((await s.retireSeed(b.hex.id, true)).hex.status, "available");

    await assertRejects(
      () => s.createSeed({ title: "x", description: "", gitUrl: "  " }),
      DomainError,
    );
    const missing = await assertRejects(() => s.updateSeed("hx-seed-fff", {}), DomainError);
    assertEquals(missing.status, 404);
  } finally {
    await f.cleanup();
  }
});

Deno.test("seeds over REST and MCP", async () => {
  const f = await fixture();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await buildServer(f.service).connect(serverT);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientT);
  try {
    const app = createApp(f.service);
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(`/api${path}`, {
        method,
        headers: { host: "localhost:8000", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, body: await res.json() };
    };
    const made = await call("POST", "/seeds", { title: "Py", gitUrl: "/srv/py.git" });
    assertEquals(made.status, 201);
    assertEquals((await call("POST", "/seeds", { title: "No URL" })).status, 400);
    const id = made.body.hex.id;
    assertEquals(
      (await call("PATCH", `/seeds/${id}`, { title: "Python" })).body.hex.title,
      "Python",
    );
    assertEquals((await call("POST", `/seeds/${id}/retire`)).body.hex.status, "retired");
    assertEquals((await call("GET", "/seeds")).body, []);
    assertEquals((await call("GET", "/seeds?retired=1")).body.length, 1);
    assertEquals((await call("POST", `/seeds/${id}/restore`)).body.hex.status, "available");

    const tool = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as { text: string }[])[0]!.text;
      return JSON.parse(text);
    };
    const viaMcp = await tool("create_seed", { title: "Rust CLI", git_url: "/srv/rust.git" });
    assertEquals(viaMcp.branch, "main");
    await tool("update_seed", { seed_id: viaMcp.hex.id, description: "clap + tokio." });
    const listed = await tool("list_seeds", {});
    assertEquals(listed.map((x: { hex: { title: string } }) => x.hex.title), [
      "Python",
      "Rust CLI",
    ]);
    await tool("retire_seed", { seed_id: viaMcp.hex.id });
    assertEquals((await tool("list_seeds", {})).length, 1);
  } finally {
    await client.close();
    await f.cleanup();
  }
});

Deno.test("a project never takes the seed or studio prefix", async () => {
  const f = await fixture("Alpha", { v2: true });
  try {
    for (const title of ["Seed Demo", "Studio Thing"]) {
      const { projectId } = await f.service.createProject({
        dir: "",
        title,
        description: "",
        gitInit: false,
      });
      assert(!/^hx-(seed|studio)-/.test(projectId), projectId);
    }
  } finally {
    await f.cleanup();
  }
});
