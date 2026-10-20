import { roleOf } from "./constants.ts";
import type { GraphNode } from "./views.ts";

export interface Match {
  node: GraphNode;
  /** [start, end) ranges in `node.title` to highlight; empty when matched by id alone. */
  ranges: [number, number][];
}

interface Word {
  text: string;
  start: number;
}

/** Runs of letters and digits, lowercased, with where each starts. */
function words(text: string): Word[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    text: m[0].toLowerCase(),
    start: m.index,
  }));
}

/** 0 exact id, 1 id prefix, 2 title starts with the text, 3 any other title match. */
type Rank = 0 | 1 | 2 | 3;

interface Scored extends Match {
  rank: Rank;
  /** Sum of the matched title words' positions: earlier is better. */
  position: number;
}

function idRank(id: string, text: string): Rank | null {
  const short = id.slice(id.lastIndexOf("-") + 1);
  if (id === text || short === text) return 0;
  if (id.startsWith(text) || short.startsWith(text)) return 1;
  return null;
}

/**
 * Claims, left to right, the earliest unclaimed title word that each typed word starts. Null when
 * a typed word has no title word left to claim.
 */
function claim(title: Word[], typed: Word[]): number[] | null {
  const taken = new Set<number>();
  const claimed: number[] = [];
  for (const t of typed) {
    const i = title.findIndex((w, j) => !taken.has(j) && w.text.startsWith(t.text));
    if (i === -1) return null;
    taken.add(i);
    claimed.push(i);
  }
  return claimed;
}

function score(node: GraphNode, text: string, typed: Word[]): Scored | null {
  const byId = idRank(node.id, text);
  const title = words(node.title);
  const claimed = typed.length ? claim(title, typed) : null;
  if (byId === null && !claimed) return null;
  let rank: Rank = byId ?? 3;
  let position = 0;
  let ranges: [number, number][] = [];
  if (claimed) {
    position = claimed.reduce((a, b) => a + b, 0);
    if (rank > 2 && claimed.every((c, i) => c === i)) rank = 2;
    ranges = claimed
      .map((c, i): [number, number] => [title[c]!.start, title[c]!.start + typed[i]!.text.length])
      .sort((a, b) => a[0] - b[0]);
  }
  return { node, ranges, rank, position };
}

function compare(a: Scored, b: Scored): number {
  const finished = (s: Scored) => roleOf(s.node.status) === "terminal" ? 1 : 0;
  return a.rank - b.rank ||
    (a.rank === 3 ? a.position - b.position : 0) ||
    finished(a) - finished(b) ||
    b.node.updatedAt - a.node.updatedAt ||
    a.node.id.localeCompare(b.node.id);
}

/**
 * The hexes whose title words start with the typed words, or whose id starts with the text, best
 * first: an exact id, an id prefix, a title that starts with the text, then other title matches
 * by how early their matched words come. Ties go to unfinished, then recently updated hexes.
 */
export function searchHexes(nodes: readonly GraphNode[], text: string, limit = 8): Match[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return [];
  const typed = words(needle);
  const found: Scored[] = [];
  for (const node of nodes) {
    const s = score(node, needle, typed);
    if (s) found.push(s);
  }
  return found.sort(compare).slice(0, limit).map(({ node, ranges }) => ({ node, ranges }));
}
