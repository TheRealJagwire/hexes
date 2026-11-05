import type { HexSummary, ProjectView } from "../../shared/views.ts";

/** The project page's tabs, in order; Ideas is selected by default. */
export const PROJECT_TABS = [
  { key: "ideas", label: "Ideas" },
  { key: "designs", label: "Designs" },
  { key: "specs", label: "Specs" },
  { key: "decisions", label: "Decisions" },
  { key: "questions", label: "Questions" },
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number]["key"];

/** Where a hex is listed on the project page. */
export type ProjectSpot =
  | { in: "tab"; tab: ProjectTab }
  | { in: "facts" }
  | { in: "gates" }
  | { in: "epic"; epicId: string };

/** The query parameter that asks the project page to show one hex, e.g. after creating it. */
export const FOCUS_PARAM = "hex";

export function focusHref(projectId: string, hexId: string): string {
  return `/p/${projectId}?${FOCUS_PARAM}=${encodeURIComponent(hexId)}`;
}

export function focusFrom(search: string): string | null {
  return new URLSearchParams(search).get(FOCUS_PARAM);
}

const has = (items: readonly HexSummary[], id: string) => items.some((h) => h.id === id);

/**
 * Where `hexId` shows on the project page: its tab, the facts group, the gate stepper, or the epic
 * it is (or holds a story) in. Null when the page doesn't list it, such as a story no epic holds.
 */
export function spotOf(view: ProjectView, hexId: string): ProjectSpot | null {
  for (const { key } of PROJECT_TABS) {
    if (has(view[key], hexId)) return { in: "tab", tab: key };
  }
  if (has(view.facts, hexId)) return { in: "facts" };
  if (view.gates.some((g) => g.hex.id === hexId)) return { in: "gates" };
  const epic = view.epics.find((e) => e.hex.id === hexId || e.stories.some((s) => s.id === hexId));
  return epic ? { in: "epic", epicId: epic.hex.id } : null;
}
