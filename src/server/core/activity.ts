import { prefixOf } from "../../shared/graph.ts";
import type { AgentActivity, AgentCall } from "../../shared/views.ts";

/** How long a changed hex stays the one an agent is working on. */
export const WORKING_MS = 10 * 60_000;
const KEEP = 200;

type Listener = (call: AgentCall) => void;

/** The hex a tool call is about: its `id`, else the hex it returned, else its `project_id`. */
export function hexIdOf(args: unknown, result: unknown): string | null {
  const a = (args ?? {}) as Record<string, unknown>;
  const r = (result ?? {}) as Record<string, unknown>;
  for (const v of [a.id, a.hex_id, r.id, a.project_id]) {
    if (typeof v === "string" && prefixOf(v)) return v;
  }
  return null;
}

/**
 * Every MCP tool call an agent made through Studio, kept in memory (the latest 200). Listeners
 * hear about calls at most once a second, with the latest one.
 */
export class ActivityLog {
  private calls: AgentCall[] = [];
  private readonly listeners = new Set<Listener>();
  private timer: number | undefined;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly debounceMs = 1000,
  ) {}

  record(call: Omit<AgentCall, "at">): void {
    const full = { ...call, at: this.now() };
    this.calls = [...this.calls, full].slice(-KEEP);
    if (this.timer !== undefined || this.listeners.size === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const latest = this.calls[this.calls.length - 1]!;
      for (const l of this.listeners) l(latest);
    }, this.debounceMs);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    };
  }

  /**
   * For one project: the latest call that was about it or about no hex at all (`get_workspace`),
   * and the hex most recently changed in it within ten minutes. Reads never set that hex.
   */
  forProject(projectId: string): AgentActivity {
    const prefix = prefixOf(projectId);
    const mine = this.calls.filter((c) => c.hexId === null || prefixOf(c.hexId) === prefix);
    const lastCall = mine[mine.length - 1] ?? null;
    const since = this.now() - WORKING_MS;
    const changed = mine.filter((c) => !c.read && c.hexId !== null && c.at >= since);
    const w = changed[changed.length - 1];
    return {
      lastCall,
      working: w ? { hexId: w.hexId!, tool: w.tool, at: w.at } : null,
    };
  }
}
