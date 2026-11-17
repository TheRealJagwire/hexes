import { DataFileSchema } from "../../shared/schemas.ts";
import type { InspectResult } from "../../shared/views.ts";
import { DomainError } from "./errors.ts";
import { ensureMigrated } from "./migrate.ts";
import { repoPathOf } from "../../shared/graph.ts";
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
 * Which project directory Studio and the MCP server are working on. Shared between both
 * processes through a small state file, so opening a folder in Studio retargets MCP too.
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

  /** Merges `patch` into the state file, keeping keys it does not know, via a temp file. */
  private async writeState(patch: Record<string, unknown>): Promise<void> {
    const next = { ...await this.readState(), ...patch };
    const dir = this.stateFile.replace(/\/[^/]*$/, "");
    await Deno.mkdir(dir, { recursive: true });
    const tmp = `${this.stateFile}.${crypto.randomUUID().slice(0, 8)}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(next, null, 2) + "\n");
    await Deno.rename(tmp, this.stateFile);
  }

  async lastDir(): Promise<string | null> {
    const dir = (await this.readState()).lastDir;
    return typeof dir === "string" ? dir : null;
  }

  /** The open v1 directory (one holding `.hx/data.json`) if it still has a data file. */
  async current(): Promise<string | null> {
    const dir = this.pinnedDir ?? await this.lastDir();
    return dir && await new HexFile(dir).exists() ? dir : null;
  }

  /** Whether a v2 project with this id has a data file. Never while pinned by HEXES_DIR. */
  async hasProject(id: string): Promise<boolean> {
    return !this.pinnedDir && await this.projects.file(id).exists();
  }

  /** The selected v2 project's id, when one is selected and its data file exists. */
  async selectedV2(): Promise<string | null> {
    if (this.pinnedDir) return null;
    const id = (await this.readState()).selectedProjectId;
    return typeof id === "string" && await this.hasProject(id) ? id : null;
  }

  /** Selects a v2 project; the v1 directory is kept only as a fallback. */
  async selectV2(id: string): Promise<void> {
    await this.writeState({ selectedProjectId: id });
  }

  /** The selected v2 project's file, its `dir` being the project's repo_path when it has one. */
  async projectFile(id: string): Promise<ProjectFile> {
    const path = this.projects.projectFile(id);
    const project = (await new DataFile(path).read()).find((h) => h.id === id);
    return new ProjectFile(path, id, repoPathOf(project) ?? this.projects.projectDir(id));
  }

  /** The data file being worked on: the selected v2 project's, else the open v1 directory's. */
  async file(): Promise<HexFile | ProjectFile> {
    const id = await this.selectedV2();
    if (id) {
      const file = await this.projectFile(id);
      await ensureMigrated(file);
      return file;
    }
    const dir = await this.current();
    if (!dir) {
      throw new DomainError("No project directory is open. Open or create one first.", 409);
    }
    const file = new HexFile(dir);
    await ensureMigrated(file);
    return file;
  }

  /** Directories opened before, most recent first (at most RECENT_LIMIT). */
  async recent(): Promise<string[]> {
    const list = (await this.readState()).recent;
    return Array.isArray(list) ? list.filter((d): d is string => typeof d === "string") : [];
  }

  async remember(dir: string): Promise<void> {
    if (this.pinnedDir) return;
    const recent = [dir, ...(await this.recent()).filter((d) => d !== dir)].slice(0, RECENT_LIMIT);
    // Opening a v1 folder leaves any selected v2 project.
    await this.writeState({ lastDir: dir, recent, selectedProjectId: null });
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

  /**
   * After a v1 folder's projects moved to ~/.hx/projects: their recent entries lose the folder,
   * the folder leaves the recent list, and when it was the open one, its selected project (if it
   * moved) becomes the selected v2 project.
   */
  async adoptMigrated(dir: string, ids: readonly string[], selected: string | null): Promise<void> {
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
    const wasOpen = await this.lastDir() === dir;
    await this.writeState({
      recentProjects,
      recent: (await this.recent()).filter((d) => d !== dir),
      ...(wasOpen ? { lastDir: null } : {}),
      ...(wasOpen && selected ? { selectedProjectId: selected } : {}),
    });
  }

  async forgetProject(dir: string | undefined, projectId: string): Promise<void> {
    const list = await this.recentProjects();
    const rest = list.filter((e) => !sameProject(e, { dir, projectId }));
    if (rest.length !== list.length) await this.writeState({ recentProjects: rest });
  }

  async inspect(input: string): Promise<InspectResult> {
    const dir = resolveDir(input);
    const file = new HexFile(dir);
    if (!await file.exists()) {
      return {
        dir,
        found: false,
        hexCount: 0,
        projectCount: 0,
        error: "No .hx/data.json in this directory",
      };
    }
    try {
      const hexes = DataFileSchema.parse(JSON.parse(await Deno.readTextFile(file.path)));
      return {
        dir,
        found: true,
        hexCount: hexes.length,
        projectCount: hexes.filter((h) => h.kind === "core.project").length,
      };
    } catch (e) {
      const error = e instanceof DomainError ? e.message : "data.json is not a valid hex list";
      return { dir, found: false, hexCount: 0, projectCount: 0, error };
    }
  }

  async open(input: string): Promise<string> {
    if (this.pinnedDir) {
      throw new DomainError(`The directory is pinned to ${this.pinnedDir} by HEXES_DIR`, 409);
    }
    const info = await this.inspect(input);
    if (!info.found) throw new DomainError(info.error ?? "Not a hexes directory", 404);
    await this.remember(info.dir);
    return info.dir;
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
