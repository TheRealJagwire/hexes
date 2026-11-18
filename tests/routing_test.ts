import { assert, assertEquals, assertRejects } from "@std/assert";
import { DomainError } from "../src/server/core/errors.ts";
import { migrateToV2 } from "../src/server/core/migrate_v2.ts";
import { HexService } from "../src/server/core/service.ts";
import { HexFile } from "../src/server/core/store.ts";
import { Workspace } from "../src/server/core/workspace.ts";
import { prefixOf } from "../src/shared/graph.ts";

interface Two {
  root: string;
  workspace: Workspace;
  service: HexService;
  a: string;
  b: string;
}

type Req = Parameters<HexService["createHex"]>[0];

/** A full create request from the fields a test cares about. */
function req(fields: Partial<Req> & Pick<Req, "projectId" | "kind" | "title">): Req {
  return { description: "", status: "blocked", requiredBy: [], dependsOn: [], meta: {}, ...fields };
}

/** Two v2 projects in a temp ~/.hx, with B selected. */
async function twoProjects(): Promise<Two> {
  const root = await Deno.makeTempDir({ prefix: "hexes-routing-" });
  const workspace = new Workspace({ stateFile: `${root}/state.json`, home: `${root}/hx` });
  let clock = 1_700_000_000_000;
  const service = new HexService(workspace, () => clock += 1000);
  const create = async (title: string) =>
    (await service.createProject({ dir: "", title, description: "", gitInit: false })).projectId;
  const a = await create("Alpha");
  const b = await create("Bravo");
  await service.selectProject(b);
  return { root, workspace, service, a, b };
}

Deno.test("calls on project A work while project B is selected", async () => {
  const t = await twoProjects();
  try {
    assertEquals(await t.service.selectedProjectId(), t.b);
    const design = await t.service.createHex(req({
      projectId: t.a,
      kind: "core.design",
      title: "A design",
      dependsOn: [t.a],
    }));
    assertEquals(prefixOf(design.id), prefixOf(t.a));
    assertEquals((await t.service.getHex(design.id)).title, "A design");
    await t.service.updateHex(design.id, { title: "Renamed" });
    await t.service.setMeta(design.id, "k", "v");
    assertEquals((await t.service.getHex(design.id)).meta?.k, "v");
    assertEquals((await t.service.projectView(t.a)).project.id, t.a);

    // It landed in A's file, not in the selected project's.
    const inA = await t.workspace.projects.file(t.a).read();
    const inB = await t.workspace.projects.file(t.b).read();
    assert(inA.some((h) => h.id === design.id));
    assert(!inB.some((h) => h.id === design.id));
  } finally {
    await Deno.remove(t.root, { recursive: true });
  }
});

Deno.test("an id no project owns is refused", async () => {
  const t = await twoProjects();
  try {
    const err = await assertRejects(() => t.service.getHex("hx-nobody-abc"), DomainError);
    assertEquals(err.message, 'No project owns prefix "nobody"');
  } finally {
    await Deno.remove(t.root, { recursive: true });
  }
});

Deno.test("a dependency across two projects is refused", async () => {
  const t = await twoProjects();
  try {
    const mk = (projectId: string) =>
      t.service.createHex(req({
        projectId,
        kind: "core.design",
        title: "D",
        dependsOn: [projectId],
      }));
    const inA = await mk(t.a);
    const inB = await mk(t.b);
    const err = await assertRejects(() => t.service.addDependency(inA.id, inB.id), DomainError);
    assertEquals(err.status, 422);
  } finally {
    await Deno.remove(t.root, { recursive: true });
  }
});

Deno.test("search and ready without a project cover every project", async () => {
  const t = await twoProjects();
  try {
    for (const projectId of [t.a, t.b]) {
      await t.service.createHex(req({
        projectId,
        // Not work: a project without a repository has no ready work.
        kind: "core.question",
        title: "Shared word",
        status: "ready",
      }));
    }
    const found = await t.service.search({ query: "shared word" });
    assertEquals(
      new Set(found.map((h) => prefixOf(h.id))),
      new Set([prefixOf(t.a), prefixOf(t.b)]),
    );
    const onlyA = await t.service.search({ query: "shared word", projectId: t.a });
    assertEquals(onlyA.map((h) => prefixOf(h.id)), [prefixOf(t.a)]);

    const ready = await t.service.ready();
    assertEquals(
      new Set(ready.map((h) => prefixOf(h.id))),
      new Set([prefixOf(t.a), prefixOf(t.b)]),
    );
    assertEquals((await t.service.ready(t.a)).map((h) => prefixOf(h.id)), [prefixOf(t.a)]);
  } finally {
    await Deno.remove(t.root, { recursive: true });
  }
});

Deno.test("a second project with the same title gets its own prefix", async () => {
  const t = await twoProjects();
  try {
    const again = (await t.service.createProject({
      dir: "",
      title: "Alpha",
      description: "",
      gitInit: false,
    })).projectId;
    assert(prefixOf(again) !== prefixOf(t.a), `${again} reuses the prefix of ${t.a}`);
  } finally {
    await Deno.remove(t.root, { recursive: true });
  }
});

Deno.test("migrating a v1 project whose prefix a v2 project owns is refused", async () => {
  const t = await twoProjects();
  try {
    const dir = `${t.root}/old`;
    const clash = `hx-${prefixOf(t.a)}-fff`;
    await new HexFile(dir).mutate((hexes) => {
      hexes.push({
        id: clash,
        title: "Old",
        description: "",
        kind: "core.project",
        status: "done",
        createdAtTimeInMs: 1,
        lastUpdatedAtTimeInMs: 1,
      });
    }, { create: true });
    const err = await assertRejects(
      () => migrateToV2(dir, t.workspace.projects, t.workspace),
      DomainError,
    );
    assertEquals(err.status, 409);
  } finally {
    await Deno.remove(t.root, { recursive: true });
  }
});
