import {
  HEX_ID_RE,
  REPO_PATH_KEY,
  roleOf,
  satisfies,
  SCHEMA_VERSION_KEY,
  SEED_DESCRIPTION_LIMIT,
  SEED_GIT_URL_KEY,
  SEED_KIND,
  SELECTED_PROJECT_KIND,
  type Status,
  STATUSES,
  waitsOnDependencies,
  workflowOf,
} from "./constants.ts";
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

/** Every dependency is in a status that satisfies dependents; a missing one does not. */
export function dependenciesDone(idx: HexIndex, hex: Hex): boolean {
  return (hex.dependsOn ?? []).every((id) => {
    const dep = idx.byId.get(id);
    return dep !== undefined && satisfies(dep.status);
  });
}

/**
 * Ready = in an actionable status (`ready`, …) and every dependency is satisfied, or for a kind
 * that doesn't wait on its dependencies (an idea), just actionable.
 */
export function isReady(idx: HexIndex, hex: Hex): boolean {
  return roleOf(hex.status) === "actionable" &&
    (!waitsOnDependencies(hex.kind) || dependenciesDone(idx, hex));
}

/**
 * Ready hexes, oldest first. A project's work (stories, bugs, …) is held back while the project
 * has no repository: it cannot be built anywhere. Its planning stays ready.
 */
export function readyHexes(idx: HexIndex, prefix?: string): Hex[] {
  const withoutRepo = new Set(
    idx.hexes
      .filter((h) => h.kind === "core.project" && !hasRepository(h))
      .map((h) => prefixOf(h.id)),
  );
  return idx.hexes
    .filter((h) => !h.kind.startsWith("studio.") && (!prefix || prefixOf(h.id) === prefix))
    .filter((h) => isReady(idx, h))
    .filter((h) => !(isWorkKind(h.kind) && withoutRepo.has(prefixOf(h.id))))
    .sort(byCreated);
}

export function findProject(idx: HexIndex, prefix: string): Hex | undefined {
  return idx.hexes.find((h) => h.kind === "core.project" && prefixOf(h.id) === prefix);
}

export const PULL_REQUEST_KIND = "core.pull_request";

/** The project meta key holding the auto-merge setting: `"off"` turns it off. */
export const AUTO_MERGE_KEY = "auto_merge";

/**
 * Whether a project merges each pull request as soon as it is opened. On by default: only
 * `meta.auto_merge = "off"` turns it off.
 */
export function autoMergeOn(project: Hex | undefined): boolean {
  return project?.meta?.[AUTO_MERGE_KEY] !== "off";
}

/** A project's data-file schema version: `meta.schema_version`, or 1 when it has none. */
export function schemaVersionOf(project: Hex | undefined): number {
  const n = Number.parseInt(project?.meta?.[SCHEMA_VERSION_KEY] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** The git working tree a project works on (`meta.repo_path`), or null when it is not set. */
export function repoPathOf(project: Hex | undefined): string | null {
  return project?.meta?.[REPO_PATH_KEY] || null;
}

/**
 * Whether a project has somewhere to build its work: a v1 project always does (its folder); a
 * v2 one once `meta.repo_path` is set.
 */
export function hasRepository(project: Hex | undefined): boolean {
  if (!project) return true;
  return schemaVersionOf(project) < 2 || repoPathOf(project) !== null;
}

/** What is wrong with a seed as written: an over-long description, a missing git URL. */
export function seedWarnings(seed: Pick<Hex, "description" | "meta">): string[] {
  const warnings: string[] = [];
  if (seed.description.length > SEED_DESCRIPTION_LIMIT) {
    warnings.push(`description is over ${SEED_DESCRIPTION_LIMIT} characters`);
  }
  if (!seed.meta?.[SEED_GIT_URL_KEY]) warnings.push(`meta.${SEED_GIT_URL_KEY} is missing`);
  return warnings;
}

/** The meta key set on an archived epic: the ISO time it was archived. */
export const ARCHIVED_KEY = "archived";

export function isArchived(hex: Hex): boolean {
  return hex.meta?.[ARCHIVED_KEY] !== undefined;
}

/** An epic can be archived once it has stories and every one is finished (a story's
 * finished statuses are done and merged). */
export function canArchiveEpic(stories: readonly { kind: string; status: Status }[]): boolean {
  const own = stories.filter((s) => s.kind === "core.story");
  return own.length > 0 && own.every((s) => roleOf(s.status) === "terminal");
}

/** Written and moved only by people; publishing one asks an agent for a design. */
export const IDEA_KIND = "core.idea";

/** A durable statement about the project, linked to the hexes it is about. */
export const FACT_KIND = "core.fact";

/** Planning and structure, not work: these kinds are never worked on a branch. */
const NOT_WORK = new Set([
  "core.project",
  "core.design",
  "core.spec",
  "core.decision",
  "core.gate",
  "core.epic",
  "core.question",
  IDEA_KIND,
  FACT_KIND,
  SEED_KIND,
  PULL_REQUEST_KIND,
]);

/** Kinds whose work is done on a branch and merged through a pull request (story, bug, …). */
export function isWorkKind(kind: string): boolean {
  return !NOT_WORK.has(kind) && !kind.startsWith("studio.");
}

/** The pull requests opened for a work hex (`meta.work_hex`), newest first. */
export function pullRequestsOf(idx: HexIndex, workId: string): Hex[] {
  return idx.hexes
    .filter((h) => h.kind === PULL_REQUEST_KIND && h.meta?.work_hex === workId)
    .sort((a, b) => byCreated(b, a));
}

export function projects(idx: HexIndex): Hex[] {
  return idx.hexes.filter((h) => h.kind === "core.project").sort(byCreated);
}

export function projectHexes(idx: HexIndex, prefix: string): Hex[] {
  return idx.hexes.filter((h) => prefixOf(h.id) === prefix);
}

const STORY_ORDER: Record<Status, number> = {
  in_review: 0,
  in_progress: 1,
  verified: 2,
  pull_requested: 2,
  ready: 3,
  blessed: 3,
  published: 3,
  available: 3,
  blocked: 4,
  draft: 4,
  done: 5,
  answered: 5,
  merged: 5,
  known: 5,
  closed: 6,
  retired: 6,
};

export function sortStories(stories: readonly Hex[]): Hex[] {
  return [...stories].sort((a, b) =>
    STORY_ORDER[a.status] - STORY_ORDER[b.status] || byCreated(a, b)
  );
}

export function epicStories(idx: HexIndex, epic: Hex): Hex[] {
  return sortStories(dependenciesOf(idx, epic).filter((h) => h.kind === "core.story"));
}

/** Epic list groups, most active first. */
const EPIC_IN_PROGRESS = 0;
const EPIC_READY = 1;
const EPIC_BLOCKED = 2;
const EPIC_FINISHED = 3;
const EPIC_ARCHIVED = 4;

/**
 * An epic's group: archived last whatever its status; finished once the epic itself is
 * terminal or every story is; otherwise as active as the epic or its liveliest story.
 */
export function epicGroup(idx: HexIndex, epic: Hex): number {
  if (isArchived(epic)) return EPIC_ARCHIVED;
  if (roleOf(epic.status) === "terminal") return EPIC_FINISHED;
  const stories = epicStories(idx, epic);
  const ranks = [epic, ...stories].map((h) => STORY_ORDER[h.status]);
  if (ranks.some((r) => r <= STORY_ORDER.verified)) return EPIC_IN_PROGRESS;
  if (ranks.some((r) => r === STORY_ORDER.ready)) return EPIC_READY;
  if (stories.length > 0 && stories.every((s) => roleOf(s.status) === "terminal")) {
    return EPIC_FINISHED;
  }
  return EPIC_BLOCKED;
}

/** Epics in progress → ready → blocked → finished → archived, oldest first within each. */
export function sortEpics(idx: HexIndex, epics: readonly Hex[]): Hex[] {
  const group = new Map(epics.map((e) => [e.id, epicGroup(idx, e)]));
  return [...epics].sort((a, b) => group.get(a.id)! - group.get(b.id)! || byCreated(a, b));
}

/**
 * Gates in milestone order for the project stepper: a gate always comes after any gate it reaches
 * through its dependencies (not passing through the project). Among those free to go next, done
 * gates come first, so finished milestones fill the stepper from the left, then oldest first.
 */
export function sortGates(idx: HexIndex, gates: readonly Hex[]): Hex[] {
  const ids = new Set(gates.map((g) => g.id));
  const before = new Map<string, Set<string>>();
  for (const gate of gates) {
    const reached = new Set<string>();
    const seen = new Set<string>([gate.id]);
    const stack = dependenciesOf(idx, gate);
    while (stack.length > 0) {
      const h = stack.pop()!;
      if (seen.has(h.id) || h.kind === "core.project") continue;
      seen.add(h.id);
      if (ids.has(h.id)) reached.add(h.id);
      stack.push(...dependenciesOf(idx, h));
    }
    before.set(gate.id, reached);
  }
  const rank = (g: Hex) => (roleOf(g.status) === "terminal" ? 0 : 1);
  const left = [...gates].sort((a, b) => rank(a) - rank(b) || byCreated(a, b));
  const out: Hex[] = [];
  const placed = new Set<string>();
  while (left.length > 0) {
    // A dependency cycle cannot happen (writes refuse one); fall back to the head anyway.
    let i = left.findIndex((g) => [...before.get(g.id)!].every((id) => placed.has(id)));
    if (i < 0) i = 0;
    const [next] = left.splice(i, 1);
    out.push(next!);
    placed.add(next!.id);
  }
  return out;
}

/**
 * A gate's finished epics out of all of them: an epic is finished once it is done itself, every
 * story it has is, or it is archived.
 */
export function gateProgress(idx: HexIndex, gate: Hex): Progress {
  const epics = dependenciesOf(idx, gate).filter((h) => h.kind === "core.epic");
  const finished = (epic: Hex) => {
    if (isArchived(epic) || roleOf(epic.status) === "terminal") return true;
    const { done, total } = progressOf(epicStories(idx, epic));
    return total > 0 && done === total;
  };
  const total = epics.length;
  const done = epics.filter(finished).length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export function progressOf(stories: readonly Hex[]): Progress {
  const total = stories.length;
  const done = stories.filter((s) => roleOf(s.status) === "terminal").length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Most finished first; a `Record` so a new status cannot be forgotten here. */
const SUMMARY_ORDER: Record<Status, number> = {
  done: 0,
  answered: 1,
  known: 1,
  merged: 2,
  closed: 3,
  retired: 3,
  verified: 4,
  in_review: 5,
  pull_requested: 6,
  in_progress: 7,
  blessed: 8,
  published: 9,
  available: 9,
  ready: 10,
  draft: 11,
  blocked: 12,
};

/** "2 done · 1 in progress", in status-lifecycle order. */
export function statusSummary(items: readonly { status: Status }[]): string {
  const order = [...STATUSES].sort((a, b) => SUMMARY_ORDER[a] - SUMMARY_ORDER[b]);
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
 * Keeps readiness honest for hexes whose dependencies just changed: a `blocked` hex whose
 * dependencies are all satisfied moves to its kind's `promoteTo` status (usually `ready`), and
 * an actionable hex with an unsatisfied dependency drops back to `blocked`. Only the listed ids
 * are considered, so a hex the user blocked by hand is never promoted by an unrelated change.
 * Mutates `hexes`; returns the changed ids.
 */
export function reconcileReadiness(hexes: Hex[], ids: Iterable<string>, now: number): string[] {
  const idx = buildIndex(hexes);
  const changed: string[] = [];
  for (const id of new Set(ids)) {
    const hex = idx.byId.get(id);
    if (!hex || hex.kind.startsWith("studio.") || !hex.dependsOn?.length) continue;
    if (!waitsOnDependencies(hex.kind)) continue;
    const done = dependenciesDone(idx, hex);
    const next = hex.status === "blocked" && done
      ? workflowOf(hex.kind).promoteTo
      : roleOf(hex.status) === "actionable" && !done
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
