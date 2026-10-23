import { buildIndex, byCreated, findProject, isReady, kindQualifier, prefixOf } from "./graph.ts";
import type { Hex } from "./schemas.ts";

/** What a person unblocked in one project between two snapshots. */
export interface Unblocked {
  projectId: string;
  /** Designs and specs that are blessed in `after` and were not in `before`. */
  blessed: Hex[];
  /** Questions that are answered in `after` and were not in `before`. */
  answered: { question: Hex; answer: string; decision: Hex | null }[];
  /** Ready in `after` but not in `before` (or absent from it), excluding the hexes above. */
  ready: Hex[];
}

const BLESSABLE = new Set(["core.design", "core.spec"]);

function became(before: Hex | undefined, after: Hex, status: string): boolean {
  return after.status === status && before?.status !== status;
}

/**
 * The blessings and answers between two snapshots of a workspace, with what they made ready,
 * one entry per project. Projects where only readiness moved (an agent finishing a story) are
 * left out: only a person's go-ahead counts.
 */
export function diffUnblocked(before: readonly Hex[], after: readonly Hex[]): Unblocked[] {
  const was = buildIndex(before);
  const now = buildIndex(after);
  const byProject = new Map<string, Unblocked>();
  const entry = (hex: Hex): Unblocked | null => {
    const prefix = prefixOf(hex.id);
    const project = prefix ? findProject(now, prefix) : undefined;
    if (!project) return null;
    let u = byProject.get(project.id);
    if (!u) {
      u = { projectId: project.id, blessed: [], answered: [], ready: [] };
      byProject.set(project.id, u);
    }
    return u;
  };

  const hexes = after.filter((h) => !h.kind.startsWith("studio.")).sort(byCreated);
  const moved = new Set<string>();
  for (const h of hexes) {
    const old = was.byId.get(h.id);
    if (BLESSABLE.has(h.kind) && became(old, h, "blessed")) {
      entry(h)?.blessed.push(h);
      moved.add(h.id);
    } else if (h.kind === "core.question" && became(old, h, "answered")) {
      const decision = h.meta?.decision ? now.byId.get(h.meta.decision) ?? null : null;
      entry(h)?.answered.push({ question: h, answer: h.meta?.answer ?? "", decision });
      moved.add(h.id);
    }
  }
  for (const h of hexes) {
    if (moved.has(h.id) || !isReady(now, h)) continue;
    const old = was.byId.get(h.id);
    if (old && isReady(was, old)) continue;
    const prefix = prefixOf(h.id);
    const project = prefix ? findProject(now, prefix) : undefined;
    byProject.get(project?.id ?? "")?.ready.push(h);
  }

  return [...byProject.values()]
    .filter((u) => u.blessed.length || u.answered.length)
    .sort((a, b) => a.projectId.localeCompare(b.projectId));
}

const ANSWER_MAX = 120;

/** The first line of an answer, at most 120 characters. */
function shorten(text: string): string {
  const line = text.trim().split("\n")[0]!.trim();
  return line.length > ANSWER_MAX ? `${line.slice(0, ANSWER_MAX - 1).trimEnd()}…` : line;
}

const named = (h: Hex) => `${h.id} (${kindQualifier(h.kind)}) "${h.title}"`;

/** The channel notification for one project: a few readable lines plus ids as tag attributes. */
export function formatEvent(u: Unblocked): { content: string; meta: Record<string, string> } {
  const lines: string[] = [];
  if (u.blessed.length) {
    lines.push(
      `Blessed: ${
        u.blessed.map((h) => `${kindQualifier(h.kind)} ${h.id} "${h.title}"`).join(", ")
      }`,
    );
  }
  for (const { question, answer, decision } of u.answered) {
    const to = decision ? ` → decision ${decision.id}` : "";
    lines.push(`Answered: question ${question.id} "${question.title}"${to}: "${shorten(answer)}"`);
  }
  lines.push(`Now ready: ${u.ready.length ? u.ready.map(named).join(", ") : "none yet"}`);

  const meta: Record<string, string> = { project: u.projectId, event: "unblocked" };
  const ids = {
    blessed: u.blessed.map((h) => h.id),
    answered: u.answered.map((a) => a.question.id),
    ready: u.ready.map((h) => h.id),
  };
  for (const [key, list] of Object.entries(ids)) if (list.length) meta[key] = list.join(",");
  return { content: lines.join("\n"), meta };
}
