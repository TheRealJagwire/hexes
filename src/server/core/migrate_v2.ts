import { SCHEMA_VERSION, SELECTED_PROJECT_KIND } from "../../shared/constants.ts";
import { buildIndex, prefixOf, projects } from "../../shared/graph.ts";
import type { Hex } from "../../shared/schemas.ts";
import { DomainError } from "./errors.ts";
import { migrateStatuses, migrateWorkStatuses } from "./migrate.ts";
import { HexFile, type ProjectStore } from "./store.ts";
import type { Workspace } from "./workspace.ts";

/** What a v1 file is renamed to once its projects have moved: a backup and a marker. */
export const MIGRATED_V1_SUFFIX = ".migrated-v1";

export interface MigrateOptions {
  now?: () => number;
  /** Called before each project's file is written; a throw aborts and rolls back (tests). */
  beforeWrite?: (projectId: string) => void | Promise<void>;
}

export interface MigrateResult {
  /** The ids of the projects moved to ~/.hx/projects, in creation order. */
  projects: string[];
}

/**
 * Moves a v1 `<dir>/.hx/data.json` into one schema-v2 folder per project under
 * `~/.hx/projects/<id>/`, all or nothing: an existing target folder refuses before anything is
 * written, a failed write removes what was created, and only then is the v1 file renamed to
 * `data.json.migrated-v1` and the workspace state pointed at the new projects.
 */
export async function migrateToV2(
  dir: string,
  store: ProjectStore,
  workspace: Workspace,
  opts: MigrateOptions = {},
): Promise<MigrateResult> {
  if (workspace.pinnedDir) {
    throw new DomainError(`The directory is pinned to ${workspace.pinnedDir} by HEXES_DIR`, 409);
  }
  const v1 = new HexFile(dir);
  if (!await v1.exists()) throw new DomainError(`Nothing to migrate in ${dir}`, 404);

  const hexes = await v1.read();
  const t = (opts.now ?? Date.now)();
  migrateStatuses(hexes, t);
  migrateWorkStatuses(hexes, t);

  const idx = buildIndex(hexes);
  const owned = projects(idx);
  if (!owned.length) throw new DomainError(`No projects to migrate in ${dir}`, 404);

  for (const p of owned) {
    if (await exists(store.projectDir(p.id))) {
      throw new DomainError(`${store.projectDir(p.id)} already exists; not merging into it`, 409);
    }
  }

  const sel = hexes.find((h) => h.kind === SELECTED_PROJECT_KIND)?.description;
  const created: string[] = [];
  try {
    for (const p of owned) {
      await opts.beforeWrite?.(p.id);
      const prefix = prefixOf(p.id);
      const own: Hex[] = hexes
        .filter((h) => prefixOf(h.id) === prefix && !h.kind.startsWith("studio."))
        .map((h) => structuredClone(h));
      const project = own.find((h) => h.id === p.id)!;
      project.meta = { ...project.meta, repo_path: dir, schema_version: SCHEMA_VERSION };
      await Deno.mkdir(store.projectDir(p.id), { recursive: true });
      created.push(p.id);
      await store.file(p.id).mutate((list) => {
        list.push(...own);
      }, { create: true });
      await copyDiffs(`${dir}/.hx/diffs`, `${store.projectDir(p.id)}/diffs`, prefix);
    }
  } catch (e) {
    for (const id of created) {
      await Deno.remove(store.projectDir(id), { recursive: true }).catch(() => {});
    }
    throw e;
  }

  await Deno.rename(v1.path, v1.path + MIGRATED_V1_SUFFIX);
  const ids = owned.map((p) => p.id);
  await workspace.adoptMigrated(dir, ids, sel && ids.includes(sel) ? sel : null);
  return { projects: ids };
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

/** Copies `<id>.patch` files whose id has this project's prefix. */
async function copyDiffs(from: string, to: string, prefix: string | null): Promise<void> {
  if (!prefix) return;
  let made = false;
  try {
    for await (const entry of Deno.readDir(from)) {
      if (!entry.isFile || !entry.name.endsWith(".patch")) continue;
      if (prefixOf(entry.name.slice(0, -".patch".length)) !== prefix) continue;
      if (!made) await Deno.mkdir(to, { recursive: true });
      made = true;
      await Deno.copyFile(`${from}/${entry.name}`, `${to}/${entry.name}`);
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}
