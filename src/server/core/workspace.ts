import { DomainError } from "./errors.ts";
import { ensureMigrated } from "./migrate.ts";
import { prefixOf, repoPathOf } from "../../shared/graph.ts";
import { DataFile, HexFile, ProjectFile, ProjectStore } from "./store.ts";

export interface WorkspaceOptions {
  /** Fixes the directory (the HEXES_DIR env var); `open` is then refused. */
  pinnedDir?: string | undefined;
  /** Where the last-opened directory is remembered between runs. */
  stateFile?: string | undefined;
  /** The root of per-project (schema v2) data; `~/.hx` or `$HEXES_HOME` by default. */
  home?: string | undefined;
}

const RECENT_LIMIT = 10;

/** The state file keys still in use; others are dropped on the next write. */
const STATE_KEYS = ["recentProjects"] as const;

/**
 * A project opened before, remembered for switching back to it. `dir` is set for a v1 project
 * (the folder holding its `.hx/data.json`) and absent for a v2 one, found by id alone.
 */
export interface RecentProjectEntry {
  dir?: string;
  projectId: string;
  title: string;
  openedAt: number;
}

function isRecentProjectEntry(v: unknown): v is RecentProjectEntry {
  const e = v as Partial<RecentProjectEntry> | null;
  return (e?.dir === undefined || typeof e.dir === "string") && typeof e?.projectId === "string" &&
    typeof e.title === "string" && typeof e.openedAt === "number";
}

function homeDir(): string {
  return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "/";
}

export function defaultStateFile(): string {
  const base = Deno.env.get("XDG_CONFIG_HOME") ?? `${homeDir()}/.config`;
  return `${base}/hexes/state.json`;
}

/** `~/code/x` and relative paths → absolute, no trailing slash. */
export function resolveDir(input: string): string {
  let p = input.trim();
  if (p === "~" || p.startsWith("~/")) p = homeDir() + p.slice(1);
  if (!p.startsWith("/")) p = `${Deno.cwd()}/${p}`;
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}

/**
 * Where projects live: ~/.hx/projects/<id> (or a single v1 folder pinned by HEXES_DIR), plus a
 * small per-user state file with the recently opened projects. Nothing here is "selected": every
 * call names the project it is about.
 */
export class Workspace {
  readonly pinnedDir: string | null;
  readonly stateFile: string;
  readonly projects: ProjectStore;

  constructor(opts: WorkspaceOptions = {}) {
    this.pinnedDir = opts.pinnedDir ? resolveDir(opts.pinnedDir) : null;
    this.stateFile = opts.stateFile ?? defaultStateFile();
    this.projects = new ProjectStore(opts.home);
  }

  static fromEnv(): Workspace {
    return new Workspace({
      pinnedDir: Deno.env.get("HEXES_DIR"),
      stateFile: Deno.env.get("HEXES_STATE_FILE"),
      home: Deno.env.get("HEXES_HOME"),
    });
  }

  /** The state file as an object; empty when it is missing or unreadable. */
  private async readState(): Promise<Record<string, unknown>> {
    try {
      const json: unknown = JSON.parse(await Deno.readTextFile(this.stateFile));
      return json && typeof json === "object" && !Array.isArray(json)
        ? json as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  /**
   * Merges `patch` into the state file via a temp file. Only keys still in use are kept, so old
   * ones (`selectedProjectId`, `lastDir`, `recent`) go on the next write.
   */
  private async writeState(patch: Record<string, unknown>): Promise<void> {
    const merged: Record<string, unknown> = { ...await this.readState(), ...patch };
    const next = Object.fromEntries(
      STATE_KEYS.filter((k) => k in merged).map((k) => [k, merged[k]]),
    );
    const dir = this.stateFile.replace(/\/[^/]*$/, "");
    await Deno.mkdir(dir, { recursive: true });
    const tmp = `${this.stateFile}.${crypto.randomUUID().slice(0, 8)}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(next, null, 2) + "\n");
    await Deno.rename(tmp, this.stateFile);
  }

  /** The v1 folder pinned by HEXES_DIR, if it has a `.hx/data.json`. Null when not pinned. */
  async current(): Promise<string | null> {
    const dir = this.pinnedDir;
    return dir && await new HexFile(dir).exists() ? dir : null;
  }

  /** Whether a v2 project with this id has a data file. Never while pinned by HEXES_DIR. */
  async hasProject(id: string): Promise<boolean> {
    return !this.pinnedDir && await this.projects.file(id).exists();
  }

  /**
   * The v2 project that owns a hex or project id, found by the id's prefix among the folders of
   * `~/.hx/projects` (each named for its project's id). Null while pinned by HEXES_DIR, or when no
   * project there owns the prefix.
   */
  async projectFor(id: string): Promise<string | null> {
    if (this.pinnedDir) return null;
    const prefix = prefixOf(id);
    if (!prefix) return null;
    return (await this.projects.list()).find((p) => prefixOf(p) === prefix) ?? null;
  }

  /**
   * The data file holding a hex or project id: the v2 project that owns its prefix, else the v1
   * folder pinned by HEXES_DIR.
   */
  async fileFor(id: string): Promise<HexFile | ProjectFile> {
    const projectId = await this.projectFor(id);
    if (projectId) {
      const file = await this.projectFile(projectId);
      await ensureMigrated(file);
      return file;
    }
    const dir = await this.current();
    if (!dir) {
      throw new DomainError(`No project owns prefix "${prefixOf(id) ?? id}"`, 404);
    }
    const file = new HexFile(dir);
    await ensureMigrated(file);
    return file;
  }

  /** The folder holding the data file for a hex or project id and its `channels/`. */
  async dataDirFor(id: string): Promise<string | null> {
    const projectId = await this.projectFor(id);
    if (projectId) return this.projects.projectDir(projectId);
    const dir = await this.current();
    return dir ? `${dir}/.hx` : null;
  }

  /** A v2 project's file, its `dir` being the project's repo_path when it has one. */
  async projectFile(id: string): Promise<ProjectFile> {
    const path = this.projects.projectFile(id);
    const project = (await new DataFile(path).read()).find((h) => h.id === id);
    return new ProjectFile(path, id, repoPathOf(project) ?? this.projects.projectDir(id));
  }

  /** Projects opened before, across folders, most recent first (at most RECENT_LIMIT). */
  async recentProjects(): Promise<RecentProjectEntry[]> {
    const list = (await this.readState()).recentProjects;
    return Array.isArray(list) ? list.filter(isRecentProjectEntry) : [];
  }

  /** Moves a project to the front of the recent list. Not recorded while pinned by HEXES_DIR. */
  async rememberProject(entry: RecentProjectEntry): Promise<void> {
    if (this.pinnedDir) return;
    const rest = (await this.recentProjects()).filter((e) => !sameProject(e, entry));
    await this.writeState({ recentProjects: [entry, ...rest].slice(0, RECENT_LIMIT) });
  }

  /** After a v1 folder's projects moved to ~/.hx/projects, their recent entries lose the folder. */
  async adoptMigrated(dir: string, ids: readonly string[]): Promise<void> {
    const moved = new Set(ids);
    const seen = new Set<string>();
    const recentProjects: RecentProjectEntry[] = [];
    for (const e of await this.recentProjects()) {
      const next = e.dir === dir && moved.has(e.projectId)
        ? { projectId: e.projectId, title: e.title, openedAt: e.openedAt }
        : e;
      const key = `${next.dir ?? ""}\n${next.projectId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recentProjects.push(next);
    }
    await this.writeState({ recentProjects });
  }

  async forgetProject(dir: string | undefined, projectId: string): Promise<void> {
    const list = await this.recentProjects();
    const rest = list.filter((e) => !sameProject(e, { dir, projectId }));
    if (rest.length !== list.length) await this.writeState({ recentProjects: rest });
  }
}

function sameProject(
  a: { dir?: string | undefined; projectId: string },
  b: { dir?: string | undefined; projectId: string },
) {
  return (a.dir || undefined) === (b.dir || undefined) && a.projectId === b.projectId;
}

/** Runs `git init` unless the directory is already a repo. Returns a warning on failure. */
export async function gitInit(dir: string): Promise<string | null> {
  try {
    await Deno.stat(`${dir}/.git`);
    return null;
  } catch { /* not a repo yet */ }
  try {
    const out = await new Deno.Command("git", {
      args: ["init"],
      cwd: dir,
      stdout: "null",
      stderr: "piped",
    }).output();
    return out.success ? null : `git init failed: ${new TextDecoder().decode(out.stderr).trim()}`;
  } catch {
    return "git is not available, so no repository was created";
  }
}
