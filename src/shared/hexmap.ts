import type { ProjectGraph } from "./views.ts";

/** A cell on a pointy-top hex grid, in axial coordinates. */
export interface Cell {
  q: number;
  r: number;
}

const DIRECTIONS: readonly Cell[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function neighbours(c: Cell): Cell[] {
  return DIRECTIONS.map((d) => ({ q: c.q + d.q, r: c.r + d.r }));
}

export function distance(a: Cell, b: Cell): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** The cells exactly `k` steps from `center`, always in the same order; ring 0 is the centre. */
export function ring(center: Cell, k: number): Cell[] {
  if (k === 0) return [center];
  const out: Cell[] = [];
  let c = { q: center.q + DIRECTIONS[4]!.q * k, r: center.r + DIRECTIONS[4]!.r * k };
  for (const d of DIRECTIONS) {
    for (let j = 0; j < k; j++) {
      out.push(c);
      c = { q: c.q + d.q, r: c.r + d.r };
    }
  }
  return out;
}

/** The centre of a pointy-top cell whose corners are `size` from its centre. */
export function toPixel(c: Cell, size: number): { x: number; y: number } {
  return { x: size * Math.sqrt(3) * (c.q + c.r / 2), y: size * 1.5 * c.r };
}

const ORIGIN: Cell = { q: 0, r: 0 };

/** Which neighbours are visited first: the planning kinds, then work, then everything else. */
const KIND_ORDER = [
  "core.project",
  "core.design",
  "core.spec",
  "core.decision",
  "core.question",
  "core.epic",
  "core.story",
  "core.substory",
  "core.bug",
  "core.gate",
  "core.pull_request",
];

function kindRank(kind: string): number {
  const i = KIND_ORDER.indexOf(kind);
  return i === -1 ? KIND_ORDER.length : i;
}

const key = (c: Cell) => `${c.q},${c.r}`;

/**
 * Places every node of a project graph on its own cell so that linked hexes sit next to, or as
 * near as possible to, each other. The project goes at the centre; the rest follow breadth-first
 * over the links (in either direction), each into the free cell with the smallest total distance
 * to its already-placed links. Deterministic: the same graph always gives the same layout.
 */
export function hexLayout(graph: ProjectGraph): Map<string, Cell> {
  const { nodes, edges } = graph;
  // Nodes arrive ordered by creation, so their index stands in for createdAt.
  const rank = new Map(nodes.map((n, i) => [n.id, [kindRank(n.kind), i] as const]));
  const before = (a: string, b: string) => {
    const [ka, ia] = rank.get(a)!;
    const [kb, ib] = rank.get(b)!;
    return ka - kb || ia - ib;
  };
  const links = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const { from, to } of edges) {
    if (from === to || !links.has(from) || !links.has(to)) continue;
    links.get(from)!.push(to);
    links.get(to)!.push(from);
  }
  for (const list of links.values()) list.sort(before);

  const order: string[] = [];
  const seen = new Set<string>();
  const roots = nodes.map((n) => n.id).filter((id) => id !== graph.projectId).sort(before);
  if (links.has(graph.projectId)) roots.unshift(graph.projectId);
  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!;
      order.push(id);
      for (const next of links.get(id)!) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }

  const placed = new Map<string, Cell>();
  const taken = new Set<string>();
  const place = (id: string, c: Cell) => {
    placed.set(id, c);
    taken.add(key(c));
  };
  for (const id of order) {
    const anchors = links.get(id)!.map((l) => placed.get(l)).filter((c): c is Cell => !!c);
    place(id, anchors.length ? nearestTo(anchors, taken) : firstFreeFrom(ORIGIN, taken));
  }
  return placed;
}

/** The free cell nearest `center`, scanning rings outwards. */
function firstFreeFrom(center: Cell, taken: Set<string>): Cell {
  for (let k = 0;; k++) {
    const free = ring(center, k).find((c) => !taken.has(key(c)));
    if (free) return free;
  }
}

/**
 * The free cell with the smallest total distance to `anchors`, looking first at cells touching
 * an anchor, then one ring further out, and so on. Ties go to the cell nearest the centre, then
 * the lowest (q, r).
 */
function nearestTo(anchors: Cell[], taken: Set<string>): Cell {
  for (let k = 1;; k++) {
    let best: Cell | null = null;
    let bestScore: [number, number, number, number] | null = null;
    for (const a of anchors) {
      for (const c of ring(a, k)) {
        if (taken.has(key(c))) continue;
        const score: [number, number, number, number] = [
          anchors.reduce((sum, b) => sum + distance(c, b), 0),
          distance(c, ORIGIN),
          c.q,
          c.r,
        ];
        if (!bestScore || lexLess(score, bestScore)) {
          best = c;
          bestScore = score;
        }
      }
    }
    if (best) return best;
  }
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  }
  return false;
}
