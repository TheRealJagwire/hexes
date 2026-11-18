import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/build.ts";
import { createApp } from "../src/server/app.ts";
import { DomainError } from "../src/server/core/errors.ts";
import { Workspace } from "../src/server/core/workspace.ts";
import { fixture } from "./helpers.ts";

const ids = (w: Workspace) => w.recentProjects().then((l) => l.map((e) => e.projectId));

Deno.test("creating and opening projects records them, newest first, and selects nothing", async () => {
  const f = await fixture("Alpha", { v2: true });
  try {
    const s = f.service;
    const { projectId: beta } = await s.createProject({
      dir: "",
      title: "Beta",
      description: "",
      gitInit: false,
    });
    assertEquals(await ids(f.workspace), [beta, f.projectId]);

    await s.recordOpened(f.projectId);
    assertEquals(await ids(f.workspace), [f.projectId, beta]);
    await s.recordOpened(f.projectId);
    assertEquals(await ids(f.workspace), [f.projectId, beta], "once");

    // The state file holds the recent list and nothing that picks a project.
    const state = JSON.parse(await Deno.readTextFile(f.workspace.stateFile));
    assertEquals(Object.keys(state), ["recentProjects"]);

    const err = await assertRejects(() => s.recordOpened("hx-nobody-abc"), DomainError);
    assertEquals(err.status, 404);
  } finally {
    await f.cleanup();
  }
});

Deno.test("the recent list is capped, survives a corrupt file and drops old keys", async () => {
  const root = await Deno.makeTempDir({ prefix: "hexes-recent-" });
  try {
    const stateFile = `${root}/state.json`;
    const w = new Workspace({ stateFile, home: `${root}/hx` });
    await Deno.writeTextFile(stateFile, "{ not json");
    assertEquals(await w.recentProjects(), []);
    await Deno.writeTextFile(
      stateFile,
      JSON.stringify({
        selectedProjectId: "hx-p-00a",
        lastDir: "/old",
        recent: ["/old"],
        recentProjects: [{ dir: 3 }, "junk"],
      }),
    );
    assertEquals(await w.recentProjects(), [], "malformed entries are skipped");

    for (let i = 0; i < 12; i++) {
      await w.rememberProject({ projectId: `hx-p-${i}0a`, title: `P${i}`, openedAt: i });
    }
    const list = await w.recentProjects();
    assertEquals(list.length, 10);
    assertEquals(list[0]?.title, "P11");

    const state = JSON.parse(await Deno.readTextFile(stateFile));
    assertEquals(Object.keys(state), ["recentProjects"], "old keys go on the next write");

    await w.forgetProject(undefined, "hx-p-110a");
    await w.forgetProject(undefined, "hx-p-110a");
    assertEquals((await w.recentProjects()).length, 9);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("nothing is recorded while pinned by HEXES_DIR", async () => {
  const root = await Deno.makeTempDir({ prefix: "hexes-pinned-" });
  try {
    const w = new Workspace({ pinnedDir: root, stateFile: `${root}/state.json` });
    await w.rememberProject({ dir: root, projectId: "hx-p-001", title: "P", openedAt: 1 });
    assertEquals(await w.recentProjects(), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("an entry from before a v1 folder migrated opens nothing", async () => {
  const f = await fixture("Alpha", { v2: true });
  try {
    await f.workspace.rememberProject({
      dir: "/gone/folder",
      projectId: "hx-old-00a",
      title: "Old",
      openedAt: 1,
    });
    const [old, alpha] = await f.service.recentProjects();
    assertEquals([old?.title, old?.found, old?.switchable, old?.current], [
      "Old",
      false,
      false,
      false,
    ]);
    assertEquals([alpha?.projectId, alpha?.found, alpha?.switchable, alpha?.dir], [
      f.projectId,
      true,
      true,
      f.dir,
    ]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("recent projects over REST and MCP; the selection tools are gone", async () => {
  const f = await fixture("Alpha", { v2: true });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await buildServer(f.service).connect(serverT);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientT);
  try {
    const { projectId: beta } = await f.service.createProject({
      dir: "",
      title: "Beta",
      description: "",
      gitInit: false,
    });
    const app = createApp(f.service);
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(`/api${path}`, {
        method,
        headers: { host: "localhost:8000", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const list = await call("GET", "/projects/recent");
    assertEquals(list.json.map((r: { title: string }) => r.title), ["Beta", "Alpha"]);
    const opened = await call("POST", `/projects/${f.projectId}/opened`, {});
    assertEquals([opened.status, opened.json], [200, { ok: true }]);
    assertEquals((await call("GET", "/projects/recent")).json[0].title, "Alpha");
    for (const gone of ["/selected-project", "/projects/open", "/workspace/open"]) {
      assert((await call("POST", gone, {})).status >= 400, `${gone} still answers`);
    }
    const forgot = await call("POST", "/projects/recent/forget", { dir: "", projectId: beta });
    assertEquals(forgot.json, { ok: true });

    const names = (await client.listTools()).tools.map((t: { name: string }) => t.name);
    for (
      const gone of [
        "get_workspace",
        "open_workspace",
        "get_selected_project",
        "select_project",
        "open_recent_project",
      ]
    ) assert(!names.includes(gone), `${gone} is still a tool`);
    const res = await client.callTool({ name: "list_recent_projects", arguments: {} });
    const recent = JSON.parse((res.content as { text: string }[])[0]?.text ?? "null");
    assertEquals(recent.map((r: { title: string }) => r.title), ["Alpha"]);
  } finally {
    await client.close();
    await f.cleanup();
  }
});
