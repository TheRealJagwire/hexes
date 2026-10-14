import { DataFileSchema } from "../../shared/schemas.ts";
import type { InspectResult } from "../../shared/views.ts";
import { DomainError } from "./errors.ts";
import { HexFile } from "./store.ts";

export interface WorkspaceOptions {
  /** Fixes the directory (the HEXES_DIR env var); `open` is then refused. */
  pinnedDir?: string | undefined;
  /** Where the last-opened directory is remembered between runs. */
  stateFile?: string | undefined;
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
  private readonly stateFile: string;

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

  async lastDir(): Promise<string | null> {
    try {
      const json: unknown = JSON.parse(await Deno.readTextFile(this.stateFile));
      const dir = (json as { lastDir?: unknown } | null)?.lastDir;
      return typeof dir === "string" ? dir : null;
    } catch {
      return null;
    }
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
    return new HexFile(dir);
  }

  async remember(dir: string): Promise<void> {
    if (this.pinnedDir) return;
    await Deno.mkdir(this.stateFile.replace(/\/[^/]*$/, ""), { recursive: true });
    await Deno.writeTextFile(this.stateFile, JSON.stringify({ lastDir: dir }, null, 2) + "\n");
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
