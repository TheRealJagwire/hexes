import { DataFileSchema, type Hex } from "../../shared/schemas.ts";
import { DomainError } from "./errors.ts";

const locks = new Map<string, Promise<unknown>>();

/** A hex list on disk at `path`. Every operation re-reads from disk. */
export class DataFile {
  constructor(readonly path: string) {}

  /** The folder holding the file. */
  get folder(): string {
    return this.path.replace(/\/[^/]*$/, "");
  }

  protected notFound(): string {
    return `No data file at ${this.path}`;
  }

  async exists(): Promise<boolean> {
    try {
      return (await Deno.stat(this.path)).isFile;
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return false;
      throw e;
    }
  }

  async read(): Promise<Hex[]> {
    let text: string;
    try {
      text = await Deno.readTextFile(this.path);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) throw new DomainError(this.notFound(), 404);
      throw e;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new DomainError(`${this.path} is not valid JSON`, 422);
    }
    const parsed = DataFileSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DomainError(
        `${this.path} is not a valid hex list: ${issue?.path.join(".") ?? ""} ${
          issue?.message ?? ""
        }`.trim(),
        422,
      );
    }
    return parsed.data;
  }

  /**
   * Read-modify-write under an in-process lock. Writes go to a temp file that is renamed over
   * the original, so a crash never leaves half a file. The file is only written when changed.
   */
  mutate<T>(fn: (hexes: Hex[]) => T | Promise<T>, opts: { create?: boolean } = {}): Promise<T> {
    const prev = locks.get(this.path) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      const hexes = opts.create && !(await this.exists()) ? [] : await this.read();
      const before = JSON.stringify(hexes);
      const result = await fn(hexes);
      if (JSON.stringify(hexes) !== before || opts.create) await this.write(hexes);
      return result;
    });
    locks.set(this.path, run);
    return run;
  }

  private async write(hexes: Hex[]): Promise<void> {
    await Deno.mkdir(this.folder, { recursive: true });
    const tmp = `${this.path}.${crypto.randomUUID().slice(0, 8)}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(hexes, null, 2) + "\n");
    await Deno.rename(tmp, this.path);
  }
}

/** The v1 `.hx/data.json` file of one project directory. */
export class HexFile extends DataFile {
  constructor(readonly dir: string) {
    super(`${dir}/.hx/data.json`);
  }

  protected override notFound(): string {
    return `No .hx/data.json in ${this.dir}`;
  }
}

/** A v2 project's data file. `dir` is where its git work happens: its repo_path. */
export class ProjectFile extends DataFile {
  constructor(path: string, readonly projectId: string, readonly dir: string) {
    super(path);
  }
}

function homeDir(): string {
  return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "/";
}

/** The root of per-user hex data: `$HEXES_HOME`, else `~/.hx`. */
export function hexesHome(): string {
  return (Deno.env.get("HEXES_HOME") || `${homeDir()}/.hx`).replace(/\/+$/, "");
}

/**
 * Schema-version-2 storage: one folder per project, `<home>/projects/<id>/data.json`, holding
 * only that project's hexes.
 */
export class ProjectStore {
  readonly home: string;

  constructor(home: string = hexesHome()) {
    this.home = home.replace(/\/+$/, "");
  }

  get projectsDir(): string {
    return `${this.home}/projects`;
  }

  projectDir(id: string): string {
    return `${this.projectsDir}/${id}`;
  }

  projectFile(id: string): string {
    return `${this.projectDir(id)}/data.json`;
  }

  file(id: string): DataFile {
    return new DataFile(this.projectFile(id));
  }

  /** The repository seeds shared by every project: `<home>/seeds/data.json`. */
  get seedsFile(): string {
    return `${this.home}/seeds/data.json`;
  }

  seeds(): DataFile {
    return new DataFile(this.seedsFile);
  }

  /** Ids of the projects that have a data file, sorted. */
  async list(): Promise<string[]> {
    const ids: string[] = [];
    try {
      for await (const entry of Deno.readDir(this.projectsDir)) {
        if (entry.isDirectory && await this.file(entry.name).exists()) ids.push(entry.name);
      }
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return [];
      throw e;
    }
    return ids.sort();
  }
}
