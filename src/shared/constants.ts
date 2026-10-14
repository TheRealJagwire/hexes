// Plain constants with no dependencies, so the client bundle does not pull in zod.
export const STATUSES = ["ready", "in_progress", "verified", "blocked", "done"] as const;
export type Status = (typeof STATUSES)[number];

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
] as const;

export const SELECTED_PROJECT_KIND = "studio.selected_project";
export const SELECTED_PROJECT_PREFIX = "studio";

export const HEX_ID_RE = /^hx-([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{3})$/;
