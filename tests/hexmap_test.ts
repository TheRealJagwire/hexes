import { assert, assertEquals } from "@std/assert";
import { distance, hexLayout, neighbours, ring, toPixel } from "../src/shared/hexmap.ts";
import type { GraphEdge, GraphNode, ProjectGraph } from "../src/shared/views.ts";

function node(id: string, kind = "core.story"): GraphNode {
  return { id, title: id, kind, status: "ready", blurb: "", gitBranch: null, updatedAt: 0 };
}

function graph(nodes: GraphNode[], links: [string, string][]): ProjectGraph {
  return {
    projectId: nodes[0]!.id,
    nodes,
    edges: links.map(([from, to]): GraphEdge => ({ from, to })),
  };
}

/** A project with three designs, each with two stories built on it. */
function tree(): ProjectGraph {
  const nodes = [node("p", "core.project")];
  const links: [string, string][] = [];
  for (const d of ["d1", "d2", "d3"]) {
    nodes.push(node(d, "core.design"));
    links.push([d, "p"]);
    for (const s of ["a", "b"]) {
      nodes.push(node(`${d}${s}`));
      links.push([`${d}${s}`, d]);
    }
  }
  return graph(nodes, links);
}

/** A seeded random graph: every node links to one or two earlier ones. */
function random(n: number): ProjectGraph {
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const kinds = ["core.design", "core.spec", "core.epic", "core.story", "core.bug"];
  const nodes = [node("n0", "core.project")];
  const links: [string, string][] = [];
  for (let i = 1; i < n; i++) {
    nodes.push(node(`n${i}`, kinds[Math.floor(rand() * kinds.length)]));
    links.push([`n${i}`, `n${Math.floor(rand() * i)}`]);
    if (rand() < 0.5) links.push([`n${i}`, `n${Math.floor(rand() * i)}`]);
  }
  return graph(nodes, links);
}

const cells = (layout: Map<string, { q: number; r: number }>) =>
  [...layout.values()].map((c) => `${c.q},${c.r}`);

Deno.test("hex geometry: neighbours, distance, rings and pixels", () => {
  const o = { q: 0, r: 0 };
  assertEquals(neighbours(o).map((c) => distance(o, c)), [1, 1, 1, 1, 1, 1]);
  assertEquals(distance({ q: 2, r: -1 }, { q: -1, r: 1 }), 3);
  assertEquals(ring(o, 0), [o]);
  assertEquals(ring(o, 3).length, 18);
  assert(ring(o, 3).every((c) => distance(o, c) === 3));
  assertEquals(new Set(ring(o, 3).map((c) => `${c.q},${c.r}`)).size, 18);
  assertEquals(toPixel({ q: 0, r: 2 }, 10), { x: 10 * Math.sqrt(3), y: 30 });
});

Deno.test("the project is at the centre and every hex gets its own cell", () => {
  const g = tree();
  const layout = hexLayout(g);
  assertEquals(layout.get("p"), { q: 0, r: 0 });
  assertEquals(layout.size, g.nodes.length);
  assertEquals(new Set(cells(layout)).size, g.nodes.length);
});

Deno.test("the same graph always gives the same layout", () => {
  assertEquals(cells(hexLayout(random(200))), cells(hexLayout(random(200))));
});

Deno.test("a chain lands in adjacent cells", () => {
  const layout = hexLayout(graph([node("a", "core.project"), node("b"), node("c")], [
    ["c", "b"],
    ["b", "a"],
  ]));
  assertEquals(distance(layout.get("a")!, layout.get("b")!), 1);
  assertEquals(distance(layout.get("b")!, layout.get("c")!), 1);
});

Deno.test("a hex with one link sits next to it when there is room", () => {
  const layout = hexLayout(tree());
  for (const d of ["d1", "d2", "d3"]) {
    assertEquals(distance(layout.get(d)!, layout.get("p")!), 1, d);
    for (const s of ["a", "b"]) assertEquals(distance(layout.get(`${d}${s}`)!, layout.get(d)!), 1);
  }
});

Deno.test("crowded hubs keep their links close", () => {
  // Twenty designs on one project: six fit around it, the rest go in the next ring.
  const nodes = [node("p", "core.project")];
  for (let i = 0; i < 20; i++) nodes.push(node(`d${i}`, "core.design"));
  const layout = hexLayout(graph(nodes, nodes.slice(1).map((n) => [n.id, "p"])));
  const rings = nodes.slice(1).map((n) => distance(layout.get(n.id)!, { q: 0, r: 0 }));
  assertEquals(rings.filter((k) => k === 1).length, 6);
  assertEquals(rings.filter((k) => k === 2).length, 12);
  assertEquals(rings.filter((k) => k === 3).length, 2);
});

Deno.test("hexes with no links are still placed", () => {
  const g = graph([node("p", "core.project"), node("a"), node("b"), node("c")], [["a", "p"]]);
  const layout = hexLayout(g);
  assertEquals(layout.size, 4);
  assertEquals(new Set(cells(layout)).size, 4);
  // Links to hexes outside the graph are ignored.
  const outside = hexLayout({ ...g, edges: [...g.edges, { from: "b", to: "elsewhere" }] });
  assertEquals(outside.size, 4);
});

Deno.test("a thousand hexes are laid out in under 100 ms", () => {
  const g = random(1000);
  hexLayout(g); // warm up
  const t = performance.now();
  const layout = hexLayout(g);
  const ms = performance.now() - t;
  assertEquals(new Set(cells(layout)).size, 1000);
  assert(ms < 100, `took ${ms.toFixed(1)} ms`);
});
