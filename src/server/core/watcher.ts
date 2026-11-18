import { CHANNELS_DIR } from "./channels.ts";
import type { Workspace } from "./workspace.ts";

export interface ChangeEvent {
  /** Increases on every change, so a client can tell it missed one. */
  rev: number;
  /** The data folder: `<dir>/.hx` for a v1 project, `~/.hx/projects/<id>` for a v2 one. */
  dir: string | null;
  /**
   * `workspace` when the set of data folders changed (a project created or removed, another v1
   * folder opened; `dir` is the new one), `data` when the hexes in `dir` changed, `channels` when
   * a channel process wrote or removed its file under `dir/channels/`.
   */
  scope: "data" | "workspace" | "channels";
}

type Listener = (event: ChangeEvent) => void;

/** The data folders a watcher follows, at the moment it looks. */
export type Locate = () => Promise<string[]>;

/**
 * Every data folder there is: each v2 project's `~/.hx/projects/<id>`, then the open v1 folder's
 * `.hx`. Studio follows all of them, so live updates never depend on a selected project.
 */
export function allDataDirs(workspace: Workspace): Locate {
  return async () => {
    const dirs: string[] = [];
    if (!workspace.pinnedDir) {
      for (const id of await workspace.projects.list()) {
        dirs.push(workspace.projects.projectDir(id));
      }
    }
    const v1 = await workspace.current();
    if (v1) dirs.push(`${v1}/.hx`);
    return dirs;
  };
}

/**
 * Tells subscribers when `data.json` in one of the data folders it follows changes, or the set of
 * folders itself changes, no matter which process wrote it (Studio, MCP over stdio, git, an
 * editor). It watches the folders rather than the files, because writes rename a temp file over
 * `data.json` and that replaces the inode. A slow poll is the safety net for missed file-system
 * events. It only runs while somebody is subscribed.
 */
export class ChangeWatcher {
  private readonly listeners = new Set<Listener>();
  private rev = 0;
  private dirs: string[] = [];
  private stamps = new Map<string, string>();
  private channelsStamps = new Map<string, string>();
  private fs: Deno.FsWatcher | null = null;
  private watching = "";
  private poll: number | undefined;
  private debounce: number | undefined;
  private running = false;
  private checking: Promise<void> = Promise.resolve();
  private ready: Promise<void> = Promise.resolve();
  private readonly locate: Locate;

  constructor(
    private readonly workspace: Workspace,
    private readonly debounceMs = 75,
    private readonly pollMs = 2000,
    locate?: Locate,
  ) {
    this.locate = locate ?? allDataDirs(workspace);
  }

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
    return { rev: this.rev, dir: this.dirs[0] ?? null };
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
    this.dirs = [];
    this.stamps = new Map();
    this.channelsStamps = new Map();
  }

  private schedule(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.check(true), this.debounceMs);
  }

  /** Serialised: compares the folders and their file stamps with the last look and notifies. */
  private check(notify: boolean): Promise<void> {
    this.checking = this.checking.then(async () => {
      if (!this.running) return;
      let dirs: string[] = [];
      try {
        dirs = await this.locate();
      } catch { /* look again next tick */ }
      const stamps = new Map<string, string>();
      const channelsStamps = new Map<string, string>();
      for (const dir of dirs) {
        try {
          const s = await Deno.stat(`${dir}/data.json`);
          stamps.set(dir, `${s.mtime?.getTime()}:${s.size}:${s.ino}`);
        } catch {
          /* mid-rename or gone: treat as unchanged and look again next tick */
          stamps.set(dir, this.stamps.get(dir) ?? "");
        }
        channelsStamps.set(dir, await stampChannels(dir));
      }
      const switched = dirs.join("|") !== this.dirs.join("|");
      const added = dirs.find((d) => !this.dirs.includes(d)) ?? dirs[0] ?? null;
      const changed = dirs.find((d) => stamps.get(d) !== this.stamps.get(d));
      const channelsChanged = dirs.find((d) =>
        channelsStamps.get(d) !== this.channelsStamps.get(d)
      );
      this.dirs = dirs;
      this.stamps = stamps;
      this.channelsStamps = channelsStamps;
      await this.rewatch(dirs);
      if (!notify) return;
      if (switched) this.emit({ rev: ++this.rev, dir: added, scope: "workspace" });
      else {
        if (changed) this.emit({ rev: ++this.rev, dir: changed, scope: "data" });
        if (channelsChanged) {
          this.emit({ rev: ++this.rev, dir: channelsChanged, scope: "channels" });
        }
      }
    }).catch(() => {});
    return this.checking;
  }

  private emit(event: ChangeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /**
   * Watches the data folders and, unless pinned, the folder of the state file and
   * `~/.hx/projects` (where a new project's folder appears).
   */
  private async rewatch(dirs: string[]): Promise<void> {
    const paths: string[] = [...dirs];
    if (!this.workspace.pinnedDir) {
      paths.push(this.workspace.stateFile.replace(/\/[^/]*$/, ""));
      paths.push(this.workspace.projects.projectsDir);
    }
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

/** Names and modification times of the channel files, so any write or removal shows. */
async function stampChannels(dir: string): Promise<string> {
  const parts: string[] = [];
  try {
    for await (const e of Deno.readDir(`${dir}/${CHANNELS_DIR}`)) {
      if (!e.name.endsWith(".json")) continue;
      try {
        const s = await Deno.stat(`${dir}/${CHANNELS_DIR}/${e.name}`);
        parts.push(`${e.name}:${s.mtime?.getTime()}`);
      } catch { /* removed meanwhile */ }
    }
  } catch { /* no folder */ }
  return parts.sort().join("|");
}
