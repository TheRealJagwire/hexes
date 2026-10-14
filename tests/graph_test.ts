import { assertEquals } from "@std/assert";
import {
  breadcrumbs,
  buildIndex,
  epicStories,
  findCycle,
  isReady,
  progressOf,
  readyHexes,
  reconcileReadiness,
  sortStories,
  statusSummary,
} from "../src/shared/graph.ts";
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

const tree = () => [
  hex("hx-p-001", "core.project", "done"),
  hex("hx-p-0a1", "core.story", "done"),
  hex("hx-p-0a2", "core.story", "in_progress"),
  hex("hx-p-0a3", "core.story", "blocked"),
  hex("hx-p-0e1", "core.epic", "blocked", ["hx-p-0a1", "hx-p-0a2", "hx-p-0a3"]),
  hex("hx-p-0b1", "core.substory", "ready"),
  hex("hx-p-0a4", "core.story", "ready", ["hx-p-0b1"]),
  hex("hx-p-0c1", "core.gate", "blocked", ["hx-p-0e1"]),
  hex("hx-p-0d1", "core.design", "done", ["hx-p-001"]),
  hex("hx-p-0d2", "core.spec", "done", ["hx-p-0d1"]),
];

Deno.test("progress counts only stories the epic depends on", () => {
  const idx = buildIndex(tree());
  const epic = idx.byId.get("hx-p-0e1")!;
  assertEquals(progressOf(epicStories(idx, epic)), { done: 1, total: 3, pct: 33 });
  assertEquals(progressOf([]), { done: 0, total: 0, pct: 0 });
});

Deno.test("stories sort in_progress → verified → ready → blocked → done", () => {
  const stories = ["done", "blocked", "ready", "verified", "in_progress"].map((s, i) =>
    hex(`hx-p-1a${i}`, "core.story", s as Status)
  );
  assertEquals(sortStories(stories).map((s) => s.status), [
    "in_progress",
    "verified",
    "ready",
    "blocked",
    "done",
  ]);
});

Deno.test("ready means marked ready with every dependency done", () => {
  const hexes = tree();
  hexes.push(hex("hx-p-0f1", "core.story", "ready", ["hx-p-0a1"]));
  hexes.push(hex("hx-p-0f2", "core.story", "ready", ["hx-p-0a2"]));
  const idx = buildIndex(hexes);
  assertEquals(isReady(idx, idx.byId.get("hx-p-0f1")!), true);
  assertEquals(isReady(idx, idx.byId.get("hx-p-0f2")!), false);
  assertEquals(readyHexes(idx).map((h) => h.id).includes("hx-p-0f2"), false);
});

Deno.test("breadcrumbs run project › gate › epic › story", () => {
  const idx = buildIndex(tree());
  assertEquals(breadcrumbs(idx, idx.byId.get("hx-p-0a2")!).map((h) => h.id), [
    "hx-p-001",
    "hx-p-0c1",
    "hx-p-0e1",
    "hx-p-0a2",
  ]);
  assertEquals(breadcrumbs(idx, idx.byId.get("hx-p-0d2")!).map((h) => h.id), [
    "hx-p-001",
    "hx-p-0d1",
    "hx-p-0d2",
  ]);
  assertEquals(breadcrumbs(idx, idx.byId.get("hx-p-001")!).length, 1);
});

Deno.test("cycles are detected", () => {
  assertEquals(findCycle(tree()), null);
  const hexes = tree();
  hexes[1]!.dependsOn = ["hx-p-0e1"];
  assertEquals(findCycle(hexes)?.includes("hx-p-0a1"), true);
});

Deno.test("reconcile promotes unblocked hexes and demotes ready ones with open deps", () => {
  const hexes = [
    hex("hx-p-0a1", "core.story", "done"),
    hex("hx-p-0e1", "core.epic", "blocked", ["hx-p-0a1"]),
    hex("hx-p-0e2", "core.epic", "ready", ["hx-p-0a1"]),
  ];
  hexes[0]!.status = "in_progress";
  assertEquals(reconcileReadiness(hexes, ["hx-p-0e1", "hx-p-0e2"], 5), ["hx-p-0e2"]);
  assertEquals(hexes[2]!.status, "blocked");
  hexes[0]!.status = "done";
  assertEquals(reconcileReadiness(hexes, ["hx-p-0e1", "hx-p-0e2"], 6).sort(), [
    "hx-p-0e1",
    "hx-p-0e2",
  ]);
  assertEquals(hexes[1]!.status, "ready");
});

Deno.test("status summary", () => {
  assertEquals(
    statusSummary([{ status: "done" }, { status: "done" }, { status: "in_progress" }]),
    "2 done · 1 in progress",
  );
});

Deno.test("core.question hang off the project in breadcrumbs", () => {
  const idx = buildIndex([
    hex("hx-p-001", "core.project", "done"),
    hex("hx-p-0a9", "core.question", "blocked"),
  ]);
  assertEquals(breadcrumbs(idx, idx.byId.get("hx-p-0a9")!).map((h) => h.id), [
    "hx-p-001",
    "hx-p-0a9",
  ]);
});
