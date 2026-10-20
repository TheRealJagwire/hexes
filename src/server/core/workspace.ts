import { DataFileSchema } from "../../shared/schemas.ts";
import type { InspectResult } from "../../shared/views.ts";
import { DomainError } from "./errors.ts";
import { ensureMigrated } from "./migrate.ts";
import { HexFile } from "./store.ts";

export interface WorkspaceOptions {
  /** Fixes the directory (the HEXES_DIR env var); `open` is then refused. */
  pinnedDir?: string | undefined;
  /** Where the last-opened directory is remembered between runs. */
  stateFile?: string | undefined;
}

const RECENT_LIMIT = 10;

/** A project opened before, remembered across folders for switching back to it. */
export interface RecentProjectEntry {
  dir: string;
  projectId: string;
  title: string;
  openedAt: number;
}

function isRecentProjectEntry(v: unknown): v is RecentProjectEntry {
  const e = v as Partial<RecentProjectEntry> | null;
  return typeof e?.dir === "string" && typeof e.projectId === "string" &&
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

  constructor(opts: WorkspaceOptions = {}) {
    this.pinnedDir = opts.pinnedDir ? resolveDir(opts.pinnedDir) : null;
    this.stateFile = opts.stateFile ?? defaultStateFile();
  }

  static fromEnv(): Workspace {
    return new Workspace({
      pinnedDir: Deno.env.get("HEXES_DIR"),
      stateFile: Deno.env.get("HEXES_STATE_FILE"),
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

  /** The active directory if it still has a data file. */
  async current(): Promise<string | null> {
    const dir = this.pinnedDir ?? await this.lastDir();
    return dir && await new HexFile(dir).exists() ? dir : null;
  }

  async file(): Promise<HexFile> {
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
    await this.writeState({ lastDir: dir, recent });
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

  async forgetProject(dir: string, projectId: string): Promise<void> {
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

function sameProject(a: { dir: string; projectId: string }, b: { dir: string; projectId: string }) {
  return a.dir === b.dir && a.projectId === b.projectId;
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
