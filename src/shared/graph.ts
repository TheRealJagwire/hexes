import { HEX_ID_RE, SELECTED_PROJECT_KIND, type Status, STATUSES } from "./constants.ts";
import type { Hex } from "./schemas.ts";
import type { HexSummary, Progress } from "./views.ts";

export interface HexIndex {
  readonly hexes: readonly Hex[];
  readonly byId: ReadonlyMap<string, Hex>;
  /** id → hexes whose `dependsOn` contains that id. */
  readonly dependents: ReadonlyMap<string, readonly Hex[]>;
}

export function buildIndex(hexes: readonly Hex[]): HexIndex {
  const byId = new Map<string, Hex>();
  const dependents = new Map<string, Hex[]>();
  for (const hex of hexes) byId.set(hex.id, hex);
  for (const hex of hexes) {
    for (const dep of hex.dependsOn ?? []) {
      const list = dependents.get(dep);
      if (list) list.push(hex);
      else dependents.set(dep, [hex]);
    }
  }
  return { hexes, byId, dependents };
}

export function parseHexId(id: string): { prefix: string; hash: string } | null {
  const m = HEX_ID_RE.exec(id);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { prefix: m[1], hash: m[2] };
}

export function prefixOf(id: string): string | null {
  return parseHexId(id)?.prefix ?? null;
}

/** `core.story` → `story`. */
export function kindQualifier(kind: string): string {
  return kind.split(".")[1] ?? kind;
}

export function byCreated(a: Hex, b: Hex): number {
  return a.createdAtTimeInMs - b.createdAtTimeInMs || a.id.localeCompare(b.id);
}

export function summarize(hex: Hex): HexSummary {
  return { id: hex.id, title: hex.title, kind: hex.kind, status: hex.status };
}

export function dependenciesOf(idx: HexIndex, hex: Hex): Hex[] {
  const out: Hex[] = [];
  for (const id of hex.dependsOn ?? []) {
    const dep = idx.byId.get(id);
    if (dep) out.push(dep);
  }
  return out;
}

export function dependentsOf(idx: HexIndex, id: string): Hex[] {
  return [...(idx.dependents.get(id) ?? [])].sort(byCreated);
}

/** A dependency that no longer exists counts as not done. */
export function dependenciesDone(idx: HexIndex, hex: Hex): boolean {
  return (hex.dependsOn ?? []).every((id) => idx.byId.get(id)?.status === "done");
}

/** Ready = marked `ready` and every dependency is `done`. */
export function isReady(idx: HexIndex, hex: Hex): boolean {
  return hex.status === "ready" && dependenciesDone(idx, hex);
}

export function readyHexes(idx: HexIndex, prefix?: string): Hex[] {
  return idx.hexes
    .filter((h) => !h.kind.startsWith("studio.") && (!prefix || prefixOf(h.id) === prefix))
    .filter((h) => isReady(idx, h))
    .sort(byCreated);
}

export function findProject(idx: HexIndex, prefix: string): Hex | undefined {
  return idx.hexes.find((h) => h.kind === "core.project" && prefixOf(h.id) === prefix);
}

export function projects(idx: HexIndex): Hex[] {
  return idx.hexes.filter((h) => h.kind === "core.project").sort(byCreated);
}

export function projectHexes(idx: HexIndex, prefix: string): Hex[] {
  return idx.hexes.filter((h) => prefixOf(h.id) === prefix);
}

const STORY_ORDER: Record<Status, number> = {
  in_progress: 0,
  verified: 1,
  ready: 2,
  blocked: 3,
  done: 4,
};

export function sortStories(stories: readonly Hex[]): Hex[] {
  return [...stories].sort((a, b) =>
    STORY_ORDER[a.status] - STORY_ORDER[b.status] || byCreated(a, b)
  );
}

export function epicStories(idx: HexIndex, epic: Hex): Hex[] {
  return sortStories(dependenciesOf(idx, epic).filter((h) => h.kind === "core.story"));
}

export function progressOf(stories: readonly Hex[]): Progress {
  const total = stories.length;
  const done = stories.filter((s) => s.status === "done").length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** "2 done · 1 in progress", in status-lifecycle order. */
export function statusSummary(items: readonly { status: Status }[]): string {
  const order: Status[] = ["done", "verified", "in_progress", "ready", "blocked"];
  const parts: string[] = [];
  for (const status of order) {
    const n = items.filter((i) => i.status === status).length;
    if (n > 0) parts.push(`${n} ${status.replace("_", " ")}`);
  }
  return parts.join(" · ");
}

type ParentRule =
  | { kind: string; via: "dependents" | "dependencies" }
  | { kind: "core.project"; via: "project" };

const PROJECT_RULE: ParentRule = { kind: "core.project", via: "project" };

/**
 * Where each kind sits in the tree. Dependencies flow story → epic → gate (an epic depends on
 * its stories, a gate on its epics), so a story's parent is a *dependent* epic. Specs and
 * decisions depend on their design, so their parent is a *dependency*. Gates, designs and bugs
 * belong to the project that shares their id prefix.
 */
const PARENT_RULES: Record<string, ParentRule> = {
  "core.substory": { kind: "core.story", via: "dependents" },
  "core.story": { kind: "core.epic", via: "dependents" },
  "core.epic": { kind: "core.gate", via: "dependents" },
  "core.gate": PROJECT_RULE,
  "core.design": PROJECT_RULE,
  "core.bug": PROJECT_RULE,
  "core.question": PROJECT_RULE,
  "core.spec": { kind: "core.design", via: "dependencies" },
  "core.decision": { kind: "core.design", via: "dependencies" },
};

function parentOf(idx: HexIndex, hex: Hex): Hex | undefined {
  if (hex.kind === "core.project" || hex.kind === SELECTED_PROJECT_KIND) return undefined;
  const prefix = prefixOf(hex.id);
  const project = prefix ? findProject(idx, prefix) : undefined;
  const rule = PARENT_RULES[hex.kind];
  if (rule && rule.via !== "project") {
    const candidates = rule.via === "dependents"
      ? dependentsOf(idx, hex.id)
      : dependenciesOf(idx, hex).sort(byCreated);
    const parent = candidates.find((c) => c.kind === rule.kind);
    if (parent) return parent;
  }
  return project;
}

/** Root-first trail ending with the hex itself, e.g. project › gate › epic › story. */
export function breadcrumbs(idx: HexIndex, hex: Hex): Hex[] {
  const trail: Hex[] = [hex];
  const seen = new Set<string>([hex.id]);
  let cur = parentOf(idx, hex);
  while (cur && !seen.has(cur.id)) {
    trail.unshift(cur);
    seen.add(cur.id);
    cur = parentOf(idx, cur);
  }
  return trail;
}

/** Returns the ids along one dependency cycle, or null when the graph is acyclic. */
export function findCycle(hexes: readonly Hex[]): string[] | null {
  const byId = new Map(hexes.map((h) => [h.id, h] as const));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const hex of hexes) {
    const cycle = visit(hex.id);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Keeps `ready` honest for hexes whose dependencies just changed: a `blocked` hex whose
 * dependencies are all done becomes `ready`, and a `ready` hex with an unfinished dependency
 * drops back to `blocked`. Only the listed ids are considered, so a hex the user blocked by
 * hand is never promoted by an unrelated change. Mutates `hexes`; returns the changed ids.
 */
export function reconcileReadiness(hexes: Hex[], ids: Iterable<string>, now: number): string[] {
  const idx = buildIndex(hexes);
  const changed: string[] = [];
  for (const id of new Set(ids)) {
    const hex = idx.byId.get(id);
    if (!hex || hex.kind.startsWith("studio.") || !hex.dependsOn?.length) continue;
    const done = dependenciesDone(idx, hex);
    const next = hex.status === "blocked" && done
      ? "ready"
      : hex.status === "ready" && !done
      ? "blocked"
      : null;
    if (next) {
      hex.status = next;
      hex.lastUpdatedAtTimeInMs = now;
      changed.push(id);
    }
  }
  return changed;
}

export function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}
