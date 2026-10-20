// Plain constants with no dependencies, so the client bundle does not pull in zod.
/** Every status any kind can use. Which ones a given kind allows is in `KIND_WORKFLOWS`. */
export const STATUSES = [
  "ready",
  "in_progress",
  "verified",
  "blocked",
  "done",
  "blessed",
  "answered",
  "pull_requested",
  "merged",
  "closed",
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
  verified: { role: "active", satisfies: false },
  done: { role: "terminal", satisfies: true },
  // A design that has been approved: it can be broken down, so what depends on it unblocks.
  blessed: { role: "actionable", satisfies: true },
  // A question with a recorded response; answering also creates a `core.decision`.
  answered: { role: "terminal", satisfies: true },
  // Pull requests: open for review, merged into main (the work can finish), or abandoned.
  pull_requested: { role: "active", satisfies: false },
  merged: { role: "terminal", satisfies: true },
  closed: { role: "terminal", satisfies: false },
};

/** Statuses that are a person's approval, so agents (over MCP) may not set them. */
export const PEOPLE_ONLY: readonly Status[] = ["blessed"];

/** Statuses that can only be set together with a `response`. */
export const REQUIRES_RESPONSE: readonly Status[] = ["answered"];

export interface KindWorkflow {
  /** The statuses this kind allows, in lifecycle order. */
  statuses: readonly Status[];
  /** Where a `blocked` hex goes once its dependencies are satisfied; null to stay put. */
  promoteTo: Status | null;
}

export const DEFAULT_WORKFLOW: KindWorkflow = {
  statuses: ["blocked", "ready", "in_progress", "verified", "done"],
  promoteTo: "ready",
};

/** Kinds whose lifecycle differs from `DEFAULT_WORKFLOW`. */
export const KIND_WORKFLOWS: Readonly<Record<string, KindWorkflow>> = {
  // Blessing is an approval, so designs and specs are never promoted to it automatically.
  "core.design": { statuses: ["blocked", "in_progress", "blessed", "done"], promoteTo: null },
  "core.spec": { statuses: ["blocked", "in_progress", "blessed", "done"], promoteTo: null },
  "core.question": {
    statuses: ["blocked", "ready", "in_progress", "answered"],
    promoteTo: "ready",
  },
  // Only ever created by opening a PR, so never blocked or promoted.
  "core.pull_request": { statuses: ["pull_requested", "merged", "closed"], promoteTo: null },
};

export function workflowOf(kind: string): KindWorkflow {
  return KIND_WORKFLOWS[kind] ?? DEFAULT_WORKFLOW;
}

export function allowedStatuses(kind: string): readonly Status[] {
  return workflowOf(kind).statuses;
}

export function roleOf(status: Status): StatusRole {
  return STATUS_INFO[status].role;
}

export function satisfies(status: Status): boolean {
  return STATUS_INFO[status].satisfies;
}

/** `core.*` kinds that Studio knows how to lay out. Custom kinds are allowed too. */
export const CORE_KINDS = [
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
  "pull_request",
] as const;

export const SELECTED_PROJECT_KIND = "studio.selected_project";
export const SELECTED_PROJECT_PREFIX = "studio";

export const HEX_ID_RE = /^hx-([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{3,})$/;
