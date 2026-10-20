import { assert, assertEquals } from "@std/assert";
import type { Status } from "../src/shared/constants.ts";
import { searchHexes } from "../src/shared/search.ts";
import type { GraphNode } from "../src/shared/views.ts";

function node(id: string, title: string, status: Status = "ready", updatedAt = 0): GraphNode {
  return { id, title, kind: "core.story", status, blurb: "", gitBranch: null, updatedAt };
}

const ids = (text: string, nodes: GraphNode[], limit?: number) =>
  searchHexes(nodes, text, limit).map((m) => m.node.id);

const NODES = [
  node("hx-hexes-0c5", "Design a hex map of the whole project"),
  node("hx-hexes-721", "Give specs the blessed workflow"),
  node("hx-hexes-6d9", "Spec the per-kind status table and roles"),
  node("hx-hexes-f41", "Draw the hex map in Studio with d3"),
];

Deno.test("every typed word starts some word in the title", () => {
  assertEquals(ids("hex ma", NODES), ["hx-hexes-0c5", "hx-hexes-f41"]);
  assertEquals(ids("spec bl", NODES), ["hx-hexes-721"]);
  assertEquals(ids("map hex", NODES), ["hx-hexes-0c5", "hx-hexes-f41"], "any order");
  assertEquals(ids("ex", NODES), [], "prefixes, not substrings");
});

Deno.test("case and punctuation are ignored", () => {
  assertEquals(ids("PER-KIND", NODES), ["hx-hexes-6d9"]);
  assertEquals(ids("  Spec, the  ", NODES), ["hx-hexes-6d9", "hx-hexes-721"]);
});

Deno.test("two typed words cannot share one title word", () => {
  const nodes = [node("hx-a-001", "Start here"), node("hx-a-002", "Start the story")];
  assertEquals(ids("st st", nodes), ["hx-a-002"]);
});

Deno.test("ids match from the start, with or without the project part", () => {
  assertEquals(ids("0c5", NODES), ["hx-hexes-0c5"]);
  assertEquals(ids("hx-hexes-0c", NODES), ["hx-hexes-0c5"]);
  assertEquals(ids("hx-hexes-", NODES).length, 4);
  assertEquals(searchHexes(NODES, "0c5")[0]?.ranges, [], "nothing to highlight in the title");
});

Deno.test("ranking: exact id, id prefix, title start, then earlier words", () => {
  const nodes = [
    node("hx-a-0f1", "Polish the add button"),
    node("hx-a-0f2", "Add a button"),
    node("hx-a-add", "Unrelated"),
    node("hx-a-ad1", "Also unrelated"),
    node("hx-a-0f3", "A button to add"),
    node("hx-a-0f4", "Make add work, then a button"),
  ];
  // Exact short id, then the title that starts with "add", then by where "add" falls.
  assertEquals(ids("add", nodes), ["hx-a-add", "hx-a-0f2", "hx-a-0f4", "hx-a-0f1", "hx-a-0f3"]);
  // Id prefixes come before titles, and tie on id.
  assertEquals(ids("ad", nodes).slice(0, 3), ["hx-a-ad1", "hx-a-add", "hx-a-0f2"]);
  // Sum of word positions: 0+2, 3+1, 2+3, 1+5.
  assertEquals(ids("add bu", nodes), ["hx-a-0f2", "hx-a-0f3", "hx-a-0f1", "hx-a-0f4"]);
  assertEquals(ids("add a", nodes)[0], "hx-a-0f2", "a title that starts with the text");
});

Deno.test("ties go to unfinished hexes, then the most recently updated", () => {
  const nodes = [
    node("hx-a-001", "Fix login", "done", 30),
    node("hx-a-002", "Fix logout", "ready", 10),
    node("hx-a-003", "Fix layout", "in_progress", 20),
    node("hx-a-004", "Fix links", "merged", 40),
  ];
  assertEquals(ids("fix", nodes), ["hx-a-003", "hx-a-002", "hx-a-004", "hx-a-001"]);
});

Deno.test("ranges cover the matched start of each word, in title order", () => {
  assertEquals(searchHexes(NODES, "ma hex")[0]?.ranges, [[9, 12], [13, 15]]);
  assertEquals(searchHexes(NODES, "per-k")[0]?.ranges, [[9, 12], [13, 14]]);
});

Deno.test("limit and empty text", () => {
  assertEquals(ids("hx", NODES, 2).length, 2);
  assertEquals(ids("hx", NODES).length, 4);
  assertEquals(ids("", NODES), []);
  assertEquals(ids("   ", NODES), []);
});

Deno.test("a thousand hexes are searched in under 5 ms", () => {
  const words = ["design", "spec", "map", "search", "hex", "status", "branch", "merge", "fix"];
  const nodes = Array.from({ length: 1000 }, (_, i) =>
    node(
      `hx-p-${i.toString(16).padStart(3, "0")}`,
      `${words[i % 9]} the ${words[Math.floor(i / 9) % 9]} ${i}`,
      i % 3 ? "ready" : "done",
      i,
    ));
  searchHexes(nodes, "se ma"); // warm up
  const t = performance.now();
  const found = searchHexes(nodes, "se ma");
  const ms = performance.now() - t;
  assertEquals(found.length, 8);
  assert(ms < 5, `took ${ms.toFixed(2)} ms`);
});
