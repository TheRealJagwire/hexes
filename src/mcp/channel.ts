import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Hex } from "../shared/schemas.ts";
import { diffUnblocked, formatEvent } from "../shared/unblocked.ts";
import { type ChangeEvent, ChangeWatcher } from "../server/core/watcher.ts";
import { ChannelPresence } from "../server/core/channels.ts";
import { Workspace } from "../server/core/workspace.ts";

export const CHANNEL_INSTRUCTIONS =
  "Events from hexes-channel mean a person just unblocked work in Hexes. Act only on the " +
  "project from get_selected_project. If you are mid-task, finish the current step first. For a " +
  "published idea, run hexes-plan-work to write one core.design that depends on the project and " +
  "on the idea (emerged_from the idea), ask the user to bless it, and stop. For a " +
  "blessed design, run hexes-plan-work to break it down. For a blessed spec or an answered " +
  "question, run hexes-next-task on the newly ready hexes. Merging stays a person's call. Ignore " +
  "answers you gave yourself.";

/** One send per hex a person unblocked: `published`, `blessed` or `answered`. */
export function sendsOf(event: ChannelEvent): { hexId: string; event: string }[] {
  return (["published", "blessed", "answered"] as const).flatMap((key) =>
    (event.meta[key] ?? "").split(",").filter(Boolean).map((hexId) => ({ hexId, event: key }))
  );
}

export interface ChannelEvent {
  content: string;
  meta: Record<string, string>;
}

export interface HexesChannelOptions {
  workspace: Workspace;
  watcher: ChangeWatcher;
  send: (event: ChannelEvent) => void | Promise<void>;
  /** Told about each send, so Studio can see what went out. */
  presence?: Pick<ChannelPresence, "recordSend">;
  /** How long to wait after the last change before looking, so a burst becomes one event. */
  settleMs?: number;
}

/**
 * Watches the active workspace and sends one event per project whenever a person publishes an
 * idea, blesses a design or spec, or answers a question. Starts from what is there now, so nothing is replayed.
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
    if (e.scope === "channels") return; // heartbeats, ours included: no hexes changed
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
    for (const u of found) {
      const event = formatEvent(u);
      await this.opts.send(event);
      await this.opts.presence?.recordSend(sendsOf(event));
    }
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
  const presence = new ChannelPresence(workspace);
  const channel = new HexesChannel({
    workspace,
    watcher: new ChangeWatcher(workspace),
    send: (params) => server.notification({ method: "notifications/claude/channel", params }),
    presence,
  });
  await channel.start();
  await presence.start();
  const shutdown = async () => {
    channel.stop();
    await presence.stop();
    Deno.exit(0);
  };
  server.onclose = () => void shutdown();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    Deno.addSignalListener(signal, () => void shutdown());
  }
  console.error("hexes-channel ready (stdio)");
}
