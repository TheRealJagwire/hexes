// Plain constants with no dependencies, so the client bundle does not pull in zod.
/** Every status any kind can use. Which ones a given kind allows is in `KIND_WORKFLOWS`. */
export const STATUSES = [
  "ready",
  "in_progress",
  "in_review",
  "verified",
  "blocked",
  "done",
  "blessed",
  "answered",
  "pull_requested",
  "merged",
  "closed",
  "draft",
  "published",
  "known",
  "retired",
] as const;
export type Status = (typeof STATUSES)[number];

/**
 * What a status means to the engine, independent of its name: `waiting` on dependencies,
 * `actionable` (someone can pick it up), `active` (being worked) or `terminal` (finished).
 */
export type StatusRole = "waiting" | "actionable" | "active" | "terminal";

export interface StatusInfo {
  role: StatusRole;
  /** Whether a dependency in this status counts as finished for the hexes that depend on it. */
  satisfies: boolean;
}

export const STATUS_INFO: Record<Status, StatusInfo> = {
  blocked: { role: "waiting", satisfies: false },
  ready: { role: "actionable", satisfies: false },
  in_progress: { role: "active", satisfies: false },
  // Work whose pull request is open, waiting for review. Set only by opening one.
  in_review: { role: "active", satisfies: false },
  verified: { role: "active", satisfies: false },
  done: { role: "terminal", satisfies: true },
  // A design that has been approved: it can be broken down, so what depends on it unblocks.
  blessed: { role: "actionable", satisfies: true },
  // A question with a recorded response; answering also creates a `core.decision`.
  answered: { role: "terminal", satisfies: true },
  // Pull requests: open for review, merged into main, or abandoned. Work hexes are `merged` too,
  // once their pull request is.
  pull_requested: { role: "active", satisfies: false },
  merged: { role: "terminal", satisfies: true },
  closed: { role: "terminal", satisfies: false },
  // Ideas: a person is still writing it, or wants it designed. Both are a person's call.
  draft: { role: "waiting", satisfies: false },
  published: { role: "actionable", satisfies: true },
  // Facts: the statement holds, or it no longer does (kept for the record). Neither is work.
  known: { role: "terminal", satisfies: true },
  retired: { role: "terminal", satisfies: false },
};

/** Statuses that are a person's approval or a person's idea, so agents (over MCP) may not set them. */
export const PEOPLE_ONLY: readonly Status[] = ["blessed", "draft", "published"];

/** Statuses that only pull requests set: opening one, or merging it. Never set by hand. */
export const DERIVED: readonly Status[] = ["in_review", "merged"];

/** Statuses that can only be set together with a `response`. */
export const REQUIRES_RESPONSE: readonly Status[] = ["answered"];

export interface KindWorkflow {
  /** The statuses this kind allows, in lifecycle order. */
  statuses: readonly Status[];
  /** Where a `blocked` hex goes once its dependencies are satisfied; null to stay put. */
  promoteTo: Status | null;
}

/**
 * Work (story, substory, bug and custom kinds) moves through its pull requests: `in_review`
 * when one is opened, `merged` when it is merged. `done` is for work that never had a branch.
 */
export const DEFAULT_WORKFLOW: KindWorkflow = {
  statuses: ["blocked", "ready", "in_progress", "in_review", "merged", "done"],
  promoteTo: "ready",
};

/** Planning and structure: checked by hand, with no pull request of their own. */
const PLANNING_WORKFLOW: KindWorkflow = {
  statuses: ["blocked", "ready", "in_progress", "verified", "done"],
  promoteTo: "ready",
};

/** Kinds whose lifecycle differs from `DEFAULT_WORKFLOW`. */
export const KIND_WORKFLOWS: Readonly<Record<string, KindWorkflow>> = {
  "core.project": PLANNING_WORKFLOW,
  "core.epic": PLANNING_WORKFLOW,
  "core.gate": PLANNING_WORKFLOW,
  "core.decision": PLANNING_WORKFLOW,
  // Blessing is an approval, so designs and specs are never promoted to it automatically.
  "core.design": { statuses: ["blocked", "in_progress", "blessed", "done"], promoteTo: null },
  "core.spec": { statuses: ["blocked", "in_progress", "blessed", "done"], promoteTo: null },
  "core.question": {
    statuses: ["blocked", "ready", "in_progress", "answered"],
    promoteTo: "ready",
  },
  // Written and moved only by people: drafted, published to be designed, closed.
  "core.idea": { statuses: ["draft", "published", "done"], promoteTo: null },
  // No `blocked`: a fact is never held back by the hexes it is about.
  "core.fact": { statuses: ["known", "retired"], promoteTo: null },
  // Only ever created by opening a PR, so never blocked or promoted.
  "core.pull_request": { statuses: ["pull_requested", "merged", "closed"], promoteTo: null },
};

export function workflowOf(kind: string): KindWorkflow {
  return KIND_WORKFLOWS[kind] ?? DEFAULT_WORKFLOW;
}

export function allowedStatuses(kind: string): readonly Status[] {
  return workflowOf(kind).statuses;
}

/** The status a new hex gets when none is given: `blocked` if its kind has it, else its first. */
export function defaultStatus(kind: string): Status {
  const statuses = allowedStatuses(kind);
  return statuses.includes("blocked") ? "blocked" : statuses[0]!;
}

/**
 * Whether a kind waits on its dependencies. A kind with no `blocked` status (an idea) is never
 * held back by them: it can't be demoted, so it is actionable whatever they are.
 */
export function waitsOnDependencies(kind: string): boolean {
  return workflowOf(kind).statuses.includes("blocked");
}

export function roleOf(status: Status): StatusRole {
  return STATUS_INFO[status].role;
}

export function satisfies(status: Status): boolean {
  return STATUS_INFO[status].satisfies;
}

/** `core.*` kinds that Studio knows how to lay out. Custom kinds are allowed too. */
export const CORE_KINDS = [
  "idea",
  "project",
  "design",
  "spec",
  "decision",
  "gate",
  "epic",
  "story",
  "substory",
  "bug",
  "question",
  "fact",
  "pull_request",
] as const;

/** The data-file schema written by this version: per-project folders under ~/.hx/projects. */
export const SCHEMA_VERSION = "2";
/** Project meta keys: the schema version of its data file, and its git working tree. */
export const SCHEMA_VERSION_KEY = "schema_version";
export const REPO_PATH_KEY = "repo_path";

export const SELECTED_PROJECT_KIND = "studio.selected_project";
export const SELECTED_PROJECT_PREFIX = "studio";

export const HEX_ID_RE = /^hx-([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{3,})$/;
