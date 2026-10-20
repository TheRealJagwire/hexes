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

/** Rewrites renamed statuses in place. Returns the ids it changed; a second run changes none. */
export function migrateStatuses(hexes: Hex[], now: number): string[] {
  const changed: string[] = [];
  for (const hex of hexes) {
    const next = RENAMED[hex.kind]?.[hex.status];
    if (!next) continue;
    hex.status = next;
    hex.lastUpdatedAtTimeInMs = now;
    changed.push(hex.id);
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
