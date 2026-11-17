import type { ChannelInfo, ChannelSend } from "../../shared/views.ts";
import type { Workspace } from "./workspace.ts";

/**
 * Where channel processes say they are listening: one file per process, in this folder of the
 * data folder (`<dir>/.hx/` for v1, `~/.hx/projects/<id>/` for v2).
 */
export const CHANNELS_DIR = "channels";
export const HEARTBEAT_MS = 15_000;
/** A channel whose heartbeat is older than this is gone (killed without cleaning up). */
export const STALE_MS = 45_000;
const MAX_SENT = 20;

/** The channels listening on the data folder `dir` now, most recently started first. */
export async function readChannels(dir: string, now = Date.now()): Promise<ChannelInfo[]> {
  const found: ChannelInfo[] = [];
  try {
    for await (const entry of Deno.readDir(`${dir}/${CHANNELS_DIR}`)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      try {
        const info = JSON.parse(
          await Deno.readTextFile(`${dir}/${CHANNELS_DIR}/${entry.name}`),
        ) as ChannelInfo;
        if (typeof info.heartbeatAt === "number" && now - info.heartbeatAt <= STALE_MS) {
          found.push(info);
        }
      } catch { /* half-written or not ours: skip it */ }
    }
  } catch { /* no channels folder: nobody is listening */ }
  return found.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Keeps this channel process's file up to date: written on start, every 15 s and after each
 * send, moved when the active workspace changes, and removed on stop.
 */
export class ChannelPresence {
  private readonly startedAt: number;
  private sent: ChannelSend[] = [];
  private timer: number | undefined;
  /** The data folder the file was last written to, so it can be removed from there. */
  private writtenIn: string | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly workspace: Workspace,
    private readonly pid = Deno.pid,
    private readonly now: () => number = Date.now,
    private readonly heartbeatMs = HEARTBEAT_MS,
  ) {
    this.startedAt = now();
  }

  async start(): Promise<void> {
    await this.write();
    this.timer = setInterval(() => void this.write(), this.heartbeatMs);
  }

  /** Notes what was just sent to the Claude session, then rewrites the file. */
  recordSend(sends: Omit<ChannelSend, "at">[]): Promise<void> {
    const at = this.now();
    this.sent = [...this.sent, ...sends.map((s) => ({ ...s, at }))].slice(-MAX_SENT);
    return this.write();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.writing;
    if (this.writtenIn) await this.remove(this.writtenIn);
    this.writtenIn = null;
  }

  private write(): Promise<void> {
    this.writing = this.writing.then(async () => {
      const dir = await this.workspace.dataDir().catch(() => null);
      if (this.writtenIn && this.writtenIn !== dir) await this.remove(this.writtenIn);
      this.writtenIn = null;
      if (!dir) return;
      const info: ChannelInfo = {
        pid: this.pid,
        startedAt: this.startedAt,
        heartbeatAt: this.now(),
        sent: this.sent,
      };
      const folder = `${dir}/${CHANNELS_DIR}`;
      await Deno.mkdir(folder, { recursive: true });
      const tmp = `${folder}/.${this.pid}.json.tmp`;
      await Deno.writeTextFile(tmp, JSON.stringify(info));
      await Deno.rename(tmp, `${folder}/${this.pid}.json`);
      this.writtenIn = dir;
    }).catch((e) => console.error("hexes-channel: presence:", e));
    return this.writing;
  }

  private async remove(dir: string): Promise<void> {
    try {
      await Deno.remove(`${dir}/${CHANNELS_DIR}/${this.pid}.json`);
    } catch { /* already gone */ }
  }
}
