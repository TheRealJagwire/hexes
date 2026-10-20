import { DomainError } from "./errors.ts";

export interface GitResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

const locks = new Map<string, Promise<unknown>>();

/**
 * Git in one workspace's working tree. Hexes acts like a developer there: it switches branches
 * and merges, but never forces, resets, rebases, pushes or deletes branches.
 */
export class Git {
  constructor(readonly dir: string) {}

  /** Runs `fn` after every earlier `serial` call on this directory has finished. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(this.dir) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    locks.set(this.dir, run);
    return run;
  }

  /** Runs git and returns its output, whatever the exit code. */
  async try(...args: string[]): Promise<GitResult> {
    let out: Deno.CommandOutput;
    try {
      out = await new Deno.Command("git", {
        args,
        cwd: this.dir,
        // No prompts, and messages in English so they can be read back.
        env: { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
        stdout: "piped",
        stderr: "piped",
      }).output();
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new DomainError("git is not installed, so Hexes cannot manage branches", 501);
      }
      throw e;
    }
    const text = new TextDecoder();
    return {
      ok: out.success,
      code: out.code,
      stdout: text.decode(out.stdout).trimEnd(),
      stderr: text.decode(out.stderr).trim(),
    };
  }

  /** Runs git and returns stdout; a failure becomes a DomainError carrying git's message. */
  async run(...args: string[]): Promise<string> {
    const r = await this.try(...args);
    if (!r.ok) {
      throw new DomainError(
        `git ${args[0]} failed: ${r.stderr || r.stdout || `exit ${r.code}`}`,
        409,
      );
    }
    return r.stdout;
  }

  async assertRepo(): Promise<void> {
    const r = await this.try("rev-parse", "--is-inside-work-tree");
    if (!r.ok || r.stdout !== "true") {
      throw new DomainError(`${this.dir} is not a git repository`, 501);
    }
  }

  /** Branch switches must never touch the data file, so `.hx/` has to be ignored. */
  async assertDataIgnored(): Promise<void> {
    if (!(await this.try("check-ignore", "-q", ".hx/data.json")).ok) {
      throw new DomainError("Add .hx/ to .gitignore so switching branches leaves hexes alone", 409);
    }
  }

  /** Tracked files with uncommitted changes. Untracked files do not count. */
  async dirtyFiles(): Promise<string[]> {
    const out = await this.run("status", "--porcelain", "--untracked-files=no");
    return out ? out.split("\n").map((l) => l.slice(3)) : [];
  }

  async assertClean(): Promise<void> {
    const dirty = await this.dirtyFiles();
    if (dirty.length) {
      throw new DomainError(
        `Commit or stash your changes first: ${dirty.slice(0, 5).join(", ")}${
          dirty.length > 5 ? ` and ${dirty.length - 5} more` : ""
        }`,
        409,
      );
    }
  }

  async branchExists(name: string): Promise<boolean> {
    return (await this.try("show-ref", "--verify", "--quiet", `refs/heads/${name}`)).ok;
  }

  /** `main`, else `master`, else `preferred` when given and present. */
  async mainBranch(preferred?: string): Promise<string> {
    for (const name of [preferred, "main", "master"]) {
      if (name && await this.branchExists(name)) return name;
    }
    throw new DomainError("This repository has no main or master branch", 409);
  }

  /** The checked-out branch, or null when HEAD is detached. */
  async currentBranch(): Promise<string | null> {
    const r = await this.try("symbolic-ref", "--short", "-q", "HEAD");
    return r.ok ? r.stdout : null;
  }

  async revParse(ref: string): Promise<string> {
    return await this.run("rev-parse", "--verify", `${ref}^{commit}`);
  }

  /** Whether `ref` names a commit that still exists. */
  async hasCommit(ref: string): Promise<boolean> {
    return (await this.try("rev-parse", "--verify", "--quiet", `${ref}^{commit}`)).ok;
  }

  async mergeBase(a: string, b: string): Promise<string> {
    return await this.run("merge-base", a, b);
  }

  /** How many commits `branch` has that `base` does not. */
  async aheadOf(base: string, branch: string): Promise<number> {
    return Number(await this.run("rev-list", "--count", `${base}..${branch}`));
  }
}
