import type { Workspace } from "./workspace.ts";

export interface ChangeEvent {
  /** Increases on every change, so a client can tell it missed one. */
  rev: number;
  dir: string | null;
  /** `workspace` when the active directory switched, `data` when its hexes changed. */
  scope: "data" | "workspace";
}

type Listener = (event: ChangeEvent) => void;

/**
 * Tells subscribers when `.hx/data.json` of the active directory changes or the active
 * directory itself switches, no matter which process wrote it (Studio, MCP over stdio, git, an
 * editor). It watches the `.hx` directory rather than the file, because writes rename a temp
 * file over `data.json` and that replaces the inode. A slow poll is the safety net for missed
 * file-system events. It only runs while somebody is subscribed.
 */
export class ChangeWatcher {
  private readonly listeners = new Set<Listener>();
  private rev = 0;
  private dir: string | null = null;
  private stamp = "";
  private fs: Deno.FsWatcher | null = null;
  private watching = "";
  private poll: number | undefined;
  private debounce: number | undefined;
  private running = false;
  private checking: Promise<void> = Promise.resolve();
  private ready: Promise<void> = Promise.resolve();

  constructor(
    private readonly workspace: Workspace,
    private readonly debounceMs = 75,
    private readonly pollMs = 2000,
  ) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  /** Where things stand right now, for a client that has just connected. */
  async snapshot(): Promise<Pick<ChangeEvent, "rev" | "dir">> {
    await this.ready;
    return { rev: this.rev, dir: this.dir };
  }

  private start(): void {
    this.running = true;
    this.ready = this.check(false);
    this.poll = setInterval(() => this.schedule(), this.pollMs);
  }

  private stop(): void {
    this.running = false;
    clearInterval(this.poll);
    clearTimeout(this.debounce);
    this.closeFs();
    this.watching = "";
    this.dir = null;
    this.stamp = "";
  }

  private schedule(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.check(true), this.debounceMs);
  }

  /** Serialised: compares the directory and file stamp with the last look and notifies. */
  private check(notify: boolean): Promise<void> {
    this.checking = this.checking.then(async () => {
      if (!this.running) return;
      let dir: string | null = null;
      let stamp = "";
      try {
        dir = await this.workspace.current();
        if (dir) {
          const s = await Deno.stat(`${dir}/.hx/data.json`);
          stamp = `${s.mtime?.getTime()}:${s.size}:${s.ino}`;
        }
      } catch { /* mid-rename or gone: treat as unchanged and look again next tick */ }
      const switched = dir !== this.dir;
      const changed = stamp !== this.stamp;
      this.dir = dir;
      this.stamp = stamp;
      await this.rewatch(dir);
      if (notify && (switched || changed)) {
        this.emit({ rev: ++this.rev, dir, scope: switched ? "workspace" : "data" });
      }
    }).catch(() => {});
    return this.checking;
  }

  private emit(event: ChangeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Watches the active `.hx` folder and, unless pinned, the folder of the state file. */
  private async rewatch(dir: string | null): Promise<void> {
    const paths: string[] = [];
    if (dir) paths.push(`${dir}/.hx`);
    if (!this.workspace.pinnedDir) paths.push(this.workspace.stateFile.replace(/\/[^/]*$/, ""));
    const existing: string[] = [];
    for (const p of paths) {
      try {
        if ((await Deno.stat(p)).isDirectory) existing.push(p);
      } catch { /* not there yet; the poll picks it up once it is */ }
    }
    const key = existing.join("|");
    if (key === this.watching) return;
    this.closeFs();
    this.watching = key;
    if (existing.length === 0) return;
    const fs = Deno.watchFs(existing);
    this.fs = fs;
    void (async () => {
      try {
        for await (const _ of fs) this.schedule();
      } catch { /* closed */ }
    })();
  }

  private closeFs(): void {
    try {
      this.fs?.close();
    } catch { /* already closed */ }
    this.fs = null;
  }
}
