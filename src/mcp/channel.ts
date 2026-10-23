import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Hex } from "../shared/schemas.ts";
import { diffUnblocked, formatEvent } from "../shared/unblocked.ts";
import { type ChangeEvent, ChangeWatcher } from "../server/core/watcher.ts";
import { Workspace } from "../server/core/workspace.ts";

export const CHANNEL_INSTRUCTIONS =
  "Events from hexes-channel mean a person just unblocked work in Hexes. Act only on the " +
  "project from get_selected_project. If you are mid-task, finish the current step first. For a " +
  "blessed design, run hexes-plan-work to break it down. For a blessed spec or an answered " +
  "question, run hexes-next-task on the newly ready hexes. Merging stays a person's call. Ignore " +
  "answers you gave yourself.";

export interface ChannelEvent {
  content: string;
  meta: Record<string, string>;
}

export interface HexesChannelOptions {
  workspace: Workspace;
  watcher: ChangeWatcher;
  send: (event: ChannelEvent) => void | Promise<void>;
  /** How long to wait after the last change before looking, so a burst becomes one event. */
  settleMs?: number;
}

/**
 * Watches the active workspace and sends one event per project whenever a person blesses a
 * design or spec or answers a question. Starts from what is there now, so nothing is replayed.
 */
export class HexesChannel {
  /** What was last seen; null until a read succeeds, so a failed first read replays nothing. */
  private baseline: readonly Hex[] | null = null;
  private timer: number | undefined;
  private unsubscribe: (() => void) | null = null;
  private busy: Promise<void> = Promise.resolve();
  private readonly settleMs: number;

  constructor(private readonly opts: HexesChannelOptions) {
    this.settleMs = opts.settleMs ?? 1500;
  }

  async start(): Promise<void> {
    this.baseline = await this.read();
    this.unsubscribe = this.opts.watcher.subscribe((e) => this.onChange(e));
    await this.opts.watcher.snapshot();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Waits for any look already under way, for tests and a clean shutdown. */
  idle(): Promise<void> {
    return this.busy;
  }

  private onChange(e: ChangeEvent): void {
    clearTimeout(this.timer);
    if (e.scope === "workspace") {
      this.run(async () => {
        this.baseline = await this.read();
      });
      return;
    }
    this.timer = setTimeout(() => this.run(() => this.look()), this.settleMs);
  }

  private run(fn: () => Promise<void>): void {
    this.busy = this.busy.then(fn).catch((e) => console.error("hexes-channel:", e));
  }

  private async look(): Promise<void> {
    const now = await this.read();
    if (!now) return; // mid-rename or gone: keep the baseline and try on the next change
    const before = this.baseline;
    this.baseline = now;
    if (!before) return;
    const found = diffUnblocked(before, now);
    for (const u of found) await this.opts.send(formatEvent(u));
  }

  /** The active workspace's hexes; `[]` with no workspace, null when the file can't be read. */
  private async read(): Promise<Hex[] | null> {
    try {
      if (!await this.opts.workspace.current()) return [];
      return await (await this.opts.workspace.file()).read();
    } catch {
      return null;
    }
  }
}

if (import.meta.main) {
  // stdout belongs to the MCP transport; anything human-readable must go to stderr.
  const server = new Server(
    { name: "hexes-channel", version: "0.1.0" },
    {
      capabilities: { experimental: { "claude/channel": {} } },
      instructions: CHANNEL_INSTRUCTIONS,
    },
  );
  await server.connect(new StdioServerTransport());
  const workspace = Workspace.fromEnv();
  const channel = new HexesChannel({
    workspace,
    watcher: new ChangeWatcher(workspace),
    send: (params) => server.notification({ method: "notifications/claude/channel", params }),
  });
  await channel.start();
  server.onclose = () => {
    channel.stop();
    Deno.exit(0);
  };
  console.error("hexes-channel ready (stdio)");
}
