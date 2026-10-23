import {
  buildIndex,
  dependentsOf,
  isWorkKind,
  pullRequestsOf,
  reconcileReadiness,
} from "../../shared/graph.ts";
import type { Hex, Status } from "../../shared/schemas.ts";
import type { HexFile } from "./store.ts";

/**
 * Statuses a kind used before it got its own workflow, and what they became. A question that
 * was simply `done` has no recorded response, so it becomes `answered` without a decision hex.
 */
const RENAMED: Readonly<Record<string, Partial<Record<Status, Status>>>> = {
  "core.design": { ready: "blessed" },
  "core.spec": { ready: "blessed" },
  "core.question": { done: "answered" },
};

/**
 * Rewrites renamed statuses in place, then re-checks the hexes that depend on them, as a status
 * change would: a `ready` design or spec becoming `blessed` now satisfies what depends on it.
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
  reconcileDependents(hexes, changed, now);
  return changed;
}

/**
 * Brings work from before pull requests drove its status in line with them: finished work whose
 * pull request was merged becomes `merged`, work with an open one `in_review`, and `verified`
 * (which work no longer uses) goes back to `in_progress`. Returns the ids it changed; a second
 * run changes nothing.
 */
export function migrateWorkStatuses(hexes: Hex[], now: number): string[] {
  const idx = buildIndex(hexes);
  const changed: string[] = [];
  for (const hex of hexes) {
    if (!isWorkKind(hex.kind)) continue;
    const prs = pullRequestsOf(idx, hex.id);
    const from = hex.status;
    if (prs.some((p) => p.status === "merged") && (from === "done" || from === "verified")) {
      hex.status = "merged";
    } else if (
      prs.some((p) => p.status === "pull_requested") &&
      (from === "in_progress" || from === "verified")
    ) {
      hex.status = "in_review";
    } else if (from === "verified") {
      hex.status = "in_progress";
    } else continue;
    hex.lastUpdatedAtTimeInMs = now;
    changed.push(hex.id);
  }
  reconcileDependents(hexes, changed, now);
  return changed;
}

/** Re-checks what depends on `ids`, as a status change would. */
function reconcileDependents(hexes: Hex[], ids: readonly string[], now: number): void {
  if (!ids.length) return;
  const idx = buildIndex(hexes);
  reconcileReadiness(hexes, ids.flatMap((id) => dependentsOf(idx, id).map((d) => d.id)), now);
}

const migrated = new Map<string, Promise<void>>();

/** Migrates a data file the first time this process uses it, writing only when something changed. */
export function ensureMigrated(file: HexFile, now: () => number = Date.now): Promise<void> {
  let done = migrated.get(file.path);
  if (!done) {
    done = file.mutate((hexes) => {
      const t = now();
      return [...migrateStatuses(hexes, t), ...migrateWorkStatuses(hexes, t)];
    }).then((ids) => {
      // stderr: the stdio MCP server's stdout carries the protocol.
      if (ids.length) console.error(`hexes: migrated ${ids.length} statuses in ${file.path}`);
    });
    // A failed attempt (say, an invalid file) is retried on the next use.
    done.catch(() => migrated.delete(file.path));
    migrated.set(file.path, done);
  }
  return done;
}
