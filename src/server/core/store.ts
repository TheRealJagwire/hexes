import { DataFileSchema, type Hex } from "../../shared/schemas.ts";
import { DomainError } from "./errors.ts";

const locks = new Map<string, Promise<unknown>>();

/** The `.hx/data.json` file of one project directory. Every operation re-reads from disk. */
export class HexFile {
  readonly path: string;

  constructor(readonly dir: string) {
    this.path = `${dir}/.hx/data.json`;
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
      if (e instanceof Deno.errors.NotFound) {
        throw new DomainError(`No .hx/data.json in ${this.dir}`, 404);
      }
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
    await Deno.mkdir(`${this.dir}/.hx`, { recursive: true });
    const tmp = `${this.path}.${crypto.randomUUID().slice(0, 8)}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(hexes, null, 2) + "\n");
    await Deno.rename(tmp, this.path);
  }
}
