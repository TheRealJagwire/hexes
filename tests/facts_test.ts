import { assertEquals } from "@std/assert";
import { factsNear } from "../src/shared/facts.ts";
import { buildIndex } from "../src/shared/graph.ts";
import type { Hex, Status } from "../src/shared/schemas.ts";

let n = 0;
function hex(id: string, kind: string, status: Status, dependsOn: string[] = []): Hex {
  n++;
  const h: Hex = {
    id,
    title: id,
    description: "",
    kind,
    status,
    createdAtTimeInMs: n,
    lastUpdatedAtTimeInMs: n,
  };
  if (dependsOn.length) h.dependsOn = dependsOn;
  return h;
}

/**
 * A design with a spec, a story built on both and an epic over them; facts about the design, the
 * story, another fact and the project alone, plus a studio hex linked to the story.
 */
const graph = () => [
  hex("hx-p-001", "core.project", "in_progress"),
  hex("hx-p-0d1", "core.design", "blessed", ["hx-p-001"]),
  hex("hx-p-0s1", "core.spec", "blessed", ["hx-p-0d1"]),
  hex("hx-p-0a1", "core.story", "ready", ["hx-p-0d1", "hx-p-0s1"]),
  hex("hx-p-0e1", "core.epic", "blocked", ["hx-p-0d1", "hx-p-0s1", "hx-p-0a1"]),
  hex("hx-p-0f1", "core.fact", "known", ["hx-p-001", "hx-p-0d1"]),
  hex("hx-p-0f2", "core.fact", "known", ["hx-p-001", "hx-p-0a1"]),
  hex("hx-p-0f3", "core.fact", "known", ["hx-p-001", "hx-p-0f1"]),
  hex("hx-p-0f4", "core.fact", "known", ["hx-p-001"]),
  hex("hx-p-0x1", "studio.note", "done", ["hx-p-0a1"]),
  hex("hx-p-0f5", "core.fact", "known", ["hx-p-0x1"]),
];

const near = (hexes: Hex[], from: string, depth: number) =>
  Object.fromEntries(factsNear(buildIndex(hexes), from, depth));

Deno.test("a story finds the facts about its design within two hops, with the path", () => {
  assertEquals(near(graph(), "hx-p-0a1", 2), {
    "hx-p-0f2": ["hx-p-0a1", "hx-p-0f2"],
    "hx-p-0f1": ["hx-p-0a1", "hx-p-0d1", "hx-p-0f1"],
  });
});

Deno.test("hops are limited by depth and links count in both directions", () => {
  assertEquals(Object.keys(near(graph(), "hx-p-0a1", 1)), ["hx-p-0f2"]);
  // From the design, its fact is a dependent; from the fact, the design is a dependency.
  assertEquals(near(graph(), "hx-p-0d1", 1), { "hx-p-0f1": ["hx-p-0d1", "hx-p-0f1"] });
  assertEquals(near(graph(), "hx-p-0f1", 1), { "hx-p-0f3": ["hx-p-0f1", "hx-p-0f3"] });
});

Deno.test("the search passes through facts but never through a project or studio hex", () => {
  const far = near(graph(), "hx-p-0a1", 4);
  // A fact about a fact is reached through it.
  assertEquals(far["hx-p-0f3"], ["hx-p-0a1", "hx-p-0d1", "hx-p-0f1", "hx-p-0f3"]);
  // Only the project links to this one, and the project is never a way through.
  assertEquals(far["hx-p-0f4"], undefined);
  // Only a studio hex links to this one.
  assertEquals(far["hx-p-0f5"], undefined);
  // Starting at the project itself is allowed, and its facts are one hop away.
  assertEquals(Object.keys(near(graph(), "hx-p-001", 1)).sort(), [
    "hx-p-0f1",
    "hx-p-0f2",
    "hx-p-0f3",
    "hx-p-0f4",
  ]);
});

Deno.test("the starting hex is never in the result, even when it is a fact", () => {
  assertEquals(near(graph(), "hx-p-0f1", 4)["hx-p-0f1"], undefined);
  assertEquals(near(graph(), "hx-p-0zz", 2), {});
});

Deno.test("paths are the shortest, and the same whatever order the hexes are in", () => {
  const hexes = graph();
  const expected = near(hexes, "hx-p-0e1", 3);
  // The epic reaches the design's fact in two hops, not through the story or spec.
  assertEquals(expected["hx-p-0f1"], ["hx-p-0e1", "hx-p-0d1", "hx-p-0f1"]);
  assertEquals(near([...hexes].reverse(), "hx-p-0e1", 3), expected);
  assertEquals(near([...hexes.slice(5), ...hexes.slice(0, 5)], "hx-p-0e1", 3), expected);
});
