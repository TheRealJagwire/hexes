import { assertEquals, assertRejects } from "@std/assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/build.ts";
import { createApp } from "../src/server/app.ts";
import { DomainError } from "../src/server/core/errors.ts";
import { HexService } from "../src/server/core/service.ts";
import { Workspace } from "../src/server/core/workspace.ts";
import { fixture } from "./helpers.ts";

const ids = (w: Workspace) => w.recentProjects().then((l) => l.map((e) => e.projectId));

Deno.test("creating, opening and selecting projects records them, newest first", async () => {
  const f = await fixture("Alpha");
  try {
    const s = f.service;
    const [alpha] = await f.workspace.recentProjects();
    assertEquals([alpha?.dir, alpha?.projectId, alpha?.title], [f.dir, f.projectId, "Alpha"]);

    const betaDir = f.dir.replace(/\/proj$/, "/beta");
    const { projectId: beta } = await s.createProject({
      dir: betaDir,
      title: "Beta",
      description: "",
      gitInit: false,
    });
    assertEquals(await ids(f.workspace), [beta, f.projectId]);

    // Opening Alpha's folder brings its selected project back to the front, once.
    await s.openWorkspace(f.dir);
    assertEquals(await ids(f.workspace), [f.projectId, beta]);
    await s.selectProject(f.projectId);
    assertEquals(await ids(f.workspace), [f.projectId, beta]);
    const entries = await f.workspace.recentProjects();
    assertEquals(entries.map((e) => e.dir), [f.dir, betaDir]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("the recent list is capped, survives a corrupt file and keeps other state", async () => {
  const root = await Deno.makeTempDir({ prefix: "hexes-recent-" });
  try {
    const stateFile = `${root}/state.json`;
    const w = new Workspace({ stateFile });
    await Deno.writeTextFile(stateFile, "{ not json");
    assertEquals(await w.recentProjects(), []);
    await Deno.writeTextFile(
      stateFile,
      JSON.stringify({ future: 1, recentProjects: [{ dir: 3 }, "junk"] }),
    );
    assertEquals(await w.recentProjects(), [], "malformed entries are skipped");

    for (let i = 0; i < 12; i++) {
      await w.rememberProject({
        dir: `/d${i}`,
        projectId: `hx-p-${i}0a`,
        title: `P${i}`,
        openedAt: i,
      });
    }
    const list = await w.recentProjects();
    assertEquals(list.length, 10);
    assertEquals(list[0]?.title, "P11");

    await w.remember("/d11");
    const state = JSON.parse(await Deno.readTextFile(stateFile));
    assertEquals(state.future, 1, "unknown keys are kept");
    assertEquals(state.recentProjects.length, 10, "remembering a folder keeps recent projects");

    await w.forgetProject("/d11", "hx-p-110a");
    await w.forgetProject("/d11", "hx-p-110a");
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

Deno.test("recent projects switch folders in one step and notice what is gone", async () => {
  const f = await fixture("Alpha");
  try {
    const s = f.service;
    const betaDir = f.dir.replace(/\/proj$/, "/beta");
    const { projectId: beta } = await s.createProject({
      dir: betaDir,
      title: "Beta",
      description: "",
      gitInit: false,
    });
    let list = await s.recentProjects();
    assertEquals(list.map((r) => [r.title, r.folder, r.found, r.current, r.switchable]), [
      ["Beta", "beta", true, true, true],
      ["Alpha", "proj", true, false, true],
    ]);

    // Back to Alpha, in another folder, with one call; a later rename shows up when listed.
    const state = await s.openRecentProject(f.dir, f.projectId);
    assertEquals([state.dir, state.selectedProjectId], [f.dir, f.projectId]);
    await s.updateHex(f.projectId, { title: "Alpha 2" });
    assertEquals((await f.workspace.recentProjects())[0]?.title, "Alpha", "stored as last seen");
    list = await s.recentProjects();
    assertEquals(list.map((r) => [r.title, r.current]), [["Alpha 2", true], ["Beta", false]]);

    // A folder that disappeared is listed as not found, and opening it leaves Alpha open.
    await Deno.remove(betaDir, { recursive: true });
    list = await s.recentProjects();
    assertEquals(list.map((r) => [r.title, r.found]), [["Alpha 2", true], ["Beta", false]]);
    const err = await assertRejects(() => s.openRecentProject(betaDir, beta), DomainError);
    assertEquals(err.status, 404);
    assertEquals((await s.state()).dir, f.dir);

    await s.forgetRecentProject(betaDir, beta);
    assertEquals((await s.recentProjects()).map((r) => r.projectId), [f.projectId]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("while pinned, other folders' recent projects cannot be switched to", async () => {
  const f = await fixture("Alpha");
  try {
    const betaDir = f.dir.replace(/\/proj$/, "/beta");
    const { projectId: beta } = await f.service.createProject({
      dir: betaDir,
      title: "Beta",
      description: "",
      gitInit: false,
    });
    const pinned = new HexService(
      new Workspace({ pinnedDir: f.dir, stateFile: f.workspace.stateFile }),
    );
    const list = await pinned.recentProjects();
    assertEquals(list.map((r) => [r.title, r.switchable]), [["Beta", false], ["Alpha", true]]);
    const err = await assertRejects(() => pinned.openRecentProject(betaDir, beta), DomainError);
    assertEquals(err.status, 409);
    assertEquals(
      (await pinned.openRecentProject(f.dir, f.projectId)).selectedProjectId,
      f.projectId,
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("recent projects over REST and MCP", async () => {
  const f = await fixture("Alpha");
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await buildServer(f.service).connect(serverT);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientT);
  try {
    const betaDir = f.dir.replace(/\/proj$/, "/beta");
    const { projectId: beta } = await f.service.createProject({
      dir: betaDir,
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
      return { status: res.status, json: await res.json() };
    };
    const list = await call("GET", "/projects/recent");
    assertEquals(list.json.map((r: { title: string }) => r.title), ["Beta", "Alpha"]);
    const opened = await call("POST", "/projects/open", { dir: f.dir, projectId: f.projectId });
    assertEquals([opened.status, opened.json.selectedProjectId], [200, f.projectId]);
    assertEquals((await call("POST", "/projects/open", { dir: f.dir })).status, 400);
    const forgot = await call("POST", "/projects/recent/forget", { dir: betaDir, projectId: beta });
    assertEquals(forgot.json, { ok: true });

    const tool = async (name: string, args: Record<string, unknown>) => {
      const res = await client.callTool({ name, arguments: args });
      return JSON.parse((res.content as { text: string }[])[0]?.text ?? "null");
    };
    assertEquals((await tool("list_recent_projects", {})).map((r: { title: string }) => r.title), [
      "Alpha",
    ]);
    const state = await tool("open_recent_project", { dir: f.dir, project_id: f.projectId });
    assertEquals(state.selectedProjectId, f.projectId);
  } finally {
    await client.close();
    await f.cleanup();
  }
});
