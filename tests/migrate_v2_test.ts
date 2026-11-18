import { assert, assertEquals, assertRejects } from "@std/assert";
import { DomainError } from "../src/server/core/errors.ts";
import { migrateToV2 } from "../src/server/core/migrate_v2.ts";
import { HexService } from "../src/server/core/service.ts";
import { Workspace } from "../src/server/core/workspace.ts";
import type { Hex, Status } from "../src/shared/schemas.ts";

function hex(id: string, kind: string, status: Status, extra: Partial<Hex> = {}): Hex {
  return {
    id,
    title: id,
    description: "",
    kind,
    status,
    createdAtTimeInMs: 1,
    lastUpdatedAtTimeInMs: 1,
    ...extra,
  };
}

interface Setup {
  root: string;
  dir: string;
  workspace: Workspace;
  service: HexService;
}

/**
 * A v1 folder with two projects (alpha last opened), an old selected-project hex, an orphan hex
 * and two saved diffs.
 */
async function setup(): Promise<Setup> {
  const root = await Deno.makeTempDir({ prefix: "hexes-migrate-v2-" });
  const dir = `${root}/repo`;
  await Deno.mkdir(`${dir}/.hx/diffs`, { recursive: true });
  const hexes: Hex[] = [
    hex("hx-alpha-001", "core.project", "done"),
    hex("hx-alpha-002", "core.design", "ready", { dependsOn: ["hx-alpha-001"] }),
    hex("hx-alpha-003", "core.pull_request", "merged"),
    hex("hx-beta-001", "core.project", "done", { meta: { auto_merge: "off" } }),
    hex("hx-beta-002", "core.story", "ready", { dependsOn: ["hx-beta-001"] }),
    hex("hx-ghost-001", "core.story", "ready"),
    hex("hx-studio-001", "studio.selected_project", "done", { description: "hx-alpha-001" }),
  ];
  await Deno.writeTextFile(`${dir}/.hx/data.json`, JSON.stringify(hexes));
  await Deno.writeTextFile(`${dir}/.hx/diffs/hx-alpha-003.patch`, "diff a");
  await Deno.writeTextFile(`${dir}/.hx/diffs/hx-beta-009.patch`, "diff b");
  const workspace = new Workspace({ stateFile: `${root}/state.json`, home: `${root}/hx` });
  const service = new HexService(workspace, () => 5);
  // Both were opened in their v1 folder before; alpha most recently.
  for (const [projectId, openedAt] of [["hx-beta-001", 1], ["hx-alpha-001", 2]] as const) {
    await workspace.rememberProject({ dir, projectId, title: projectId, openedAt });
  }
  return { root, dir, workspace, service };
}

const read = async (path: string): Promise<Hex[]> => JSON.parse(await Deno.readTextFile(path));

Deno.test("migrating splits projects into folders, drops orphans and Studio's own hexes", async () => {
  const s = await setup();
  try {
    const store = s.workspace.projects;
    const res = await migrateToV2(s.dir, store, s.workspace, { now: () => 9 });
    assertEquals(res.projects, ["hx-alpha-001", "hx-beta-001"]);
    assertEquals(await store.list(), ["hx-alpha-001", "hx-beta-001"]);

    const alpha = await read(store.projectFile("hx-alpha-001"));
    assertEquals(alpha.map((h) => h.id), ["hx-alpha-001", "hx-alpha-002", "hx-alpha-003"]);
    assertEquals(alpha[0]?.meta, { repo_path: s.dir, schema_version: "2" });
    assertEquals(alpha[1]?.status, "blessed", "status migrations ran");
    const beta = await read(store.projectFile("hx-beta-001"));
    assertEquals(beta.map((h) => h.id), ["hx-beta-001", "hx-beta-002"]);
    assertEquals(beta[0]?.meta?.auto_merge, "off", "existing meta is kept");

    assertEquals(
      await Deno.readTextFile(`${store.projectDir("hx-alpha-001")}/diffs/hx-alpha-003.patch`),
      "diff a",
    );
    assertEquals(
      await Deno.readTextFile(`${store.projectDir("hx-beta-001")}/diffs/hx-beta-009.patch`),
      "diff b",
    );

    // The v1 file is kept as a backup only.
    assertEquals((await Deno.stat(`${s.dir}/.hx/data.json.migrated-v1`)).isFile, true);
    await assertRejects(() => Deno.stat(`${s.dir}/.hx/data.json`), Deno.errors.NotFound);

    assert(
      ![...alpha, ...beta].some((h) => h.kind.startsWith("studio.")),
      "the old selected-project hex is not carried over",
    );
    const recent = await s.workspace.recentProjects();
    assertEquals(recent.map((e) => [e.projectId, e.dir]), [
      ["hx-alpha-001", undefined],
      ["hx-beta-001", undefined],
    ]);
    assertEquals((await s.service.listProjects()).map((p) => [p.id, p.needsMigration]), [
      ["hx-alpha-001", false],
      ["hx-beta-001", false],
    ]);

    // A second run has nothing to do.
    const again = await assertRejects(
      () => migrateToV2(s.dir, store, s.workspace),
      DomainError,
    );
    assertEquals(again.status, 404);
  } finally {
    await Deno.remove(s.root, { recursive: true });
  }
});

Deno.test("an existing target folder refuses the migration before anything is written", async () => {
  const s = await setup();
  try {
    const store = s.workspace.projects;
    await Deno.mkdir(store.projectDir("hx-beta-001"), { recursive: true });
    const err = await assertRejects(
      () => migrateToV2(s.dir, store, s.workspace),
      DomainError,
    );
    assertEquals(err.status, 409);
    await assertRejects(() => Deno.stat(store.projectDir("hx-alpha-001")), Deno.errors.NotFound);
    assertEquals((await Deno.stat(`${s.dir}/.hx/data.json`)).isFile, true);
  } finally {
    await Deno.remove(s.root, { recursive: true });
  }
});

Deno.test("a failed write removes what was created and leaves the folder untouched", async () => {
  const s = await setup();
  try {
    const store = s.workspace.projects;
    const before = await Deno.readTextFile(`${s.dir}/.hx/data.json`);
    const stateBefore = await Deno.readTextFile(s.workspace.stateFile);
    await assertRejects(
      () =>
        migrateToV2(s.dir, store, s.workspace, {
          beforeWrite: (id) => {
            if (id === "hx-beta-001") throw new Error("disk full");
          },
        }),
      Error,
      "disk full",
    );
    assertEquals(await store.list(), []);
    await assertRejects(() => Deno.stat(store.projectDir("hx-alpha-001")), Deno.errors.NotFound);
    assertEquals(await Deno.readTextFile(`${s.dir}/.hx/data.json`), before);
    assertEquals(await Deno.readTextFile(s.workspace.stateFile), stateBefore);
  } finally {
    await Deno.remove(s.root, { recursive: true });
  }
});

Deno.test("migration is refused while pinned by HEXES_DIR", async () => {
  const s = await setup();
  try {
    const pinned = new Workspace({
      pinnedDir: s.dir,
      stateFile: s.workspace.stateFile,
      home: `${s.root}/hx`,
    });
    const err = await assertRejects(
      () => migrateToV2(s.dir, pinned.projects, pinned),
      DomainError,
    );
    assertEquals(err.status, 409);
  } finally {
    await Deno.remove(s.root, { recursive: true });
  }
});
