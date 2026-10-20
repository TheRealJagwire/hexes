import { assertEquals } from "@std/assert";
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
