import { buildIndex, dependentsOf, reconcileReadiness } from "../../shared/graph.ts";
import type { Hex, Status } from "../../shared/schemas.ts";
import type { HexFile } from "./store.ts";

/**
 * Statuses a kind used before it got its own workflow, and what they became. A question that
 * was simply `done` has no recorded response, so it becomes `answered` without a decision hex.
 */
const RENAMED: Readonly<Record<string, Partial<Record<Status, Status>>>> = {
  "core.design": { ready: "blessed" },
  "core.question": { done: "answered" },
};

/**
 * Rewrites renamed statuses in place, then re-checks the hexes that depend on them, as a status
 * change would: a `ready` design becoming `blessed` now satisfies its specs and decisions.
 * Returns the ids it renamed; a second run changes nothing.
 */
export function migrateStatuses(hexes: Hex[], now: number): string[] {
  const changed: string[] = [];
  for (const hex of hexes) {
    const next = RENAMED[hex.kind]?.[hex.status];
    if (!next) continue;
    hex.status = next;
    hex.lastUpdatedAtTimeInMs = now;
    changed.push(hex.id);
  }
  if (changed.length) {
    const idx = buildIndex(hexes);
    reconcileReadiness(hexes, changed.flatMap((id) => dependentsOf(idx, id).map((d) => d.id)), now);
  }
  return changed;
}

const migrated = new Map<string, Promise<void>>();

/** Migrates a data file the first time this process uses it, writing only when something changed. */
export function ensureMigrated(file: HexFile, now: () => number = Date.now): Promise<void> {
  let done = migrated.get(file.path);
  if (!done) {
    done = file.mutate((hexes) => migrateStatuses(hexes, now())).then((ids) => {
      // stderr: the stdio MCP server's stdout carries the protocol.
      if (ids.length) console.error(`hexes: migrated ${ids.length} statuses in ${file.path}`);
    });
    // A failed attempt (say, an invalid file) is retried on the next use.
    done.catch(() => migrated.delete(file.path));
    migrated.set(file.path, done);
  }
  return done;
}
