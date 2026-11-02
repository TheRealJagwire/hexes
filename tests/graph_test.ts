import { assertEquals } from "@std/assert";
import {
  breadcrumbs,
  buildIndex,
  epicStories,
  findCycle,
  isReady,
  isWorkKind,
  progressOf,
  pullRequestsOf,
  readyHexes,
  reconcileReadiness,
  sortEpics,
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

Deno.test("work kinds are the ones worked on a branch", () => {
  for (const k of ["core.story", "core.substory", "core.bug", "custom.task"]) {
    assertEquals(isWorkKind(k), true, k);
  }
  for (
    const k of [
      "core.design",
      "core.epic",
      "core.question",
      "core.idea",
      "core.fact",
      "core.pull_request",
      "studio.x",
    ]
  ) {
    assertEquals(isWorkKind(k), false, k);
  }
});

Deno.test("a published idea is ready whatever its project is, and is never demoted", () => {
  const hexes = [
    hex("hx-p-001", "core.project", "in_progress"),
    hex("hx-p-1d1", "core.idea", "published", ["hx-p-001"]),
    hex("hx-p-1d2", "core.idea", "draft", ["hx-p-001"]),
    hex("hx-p-0d1", "core.design", "blocked", ["hx-p-001", "hx-p-1d1"]),
  ];
  const idx = buildIndex(hexes);
  assertEquals(isReady(idx, hexes[1]!), true);
  assertEquals(isReady(idx, hexes[2]!), false);
  assertEquals(readyHexes(idx).map((h) => h.id), ["hx-p-1d1"]);
  assertEquals(reconcileReadiness(hexes, ["hx-p-1d1", "hx-p-1d2"], 9), []);
  assertEquals(hexes[1]!.status, "published");
  // A published idea satisfies what is built on it; only the project holds the design back.
  hexes[0]!.status = "done";
  assertEquals(reconcileReadiness(hexes, ["hx-p-0d1"], 10), []);
  assertEquals(isReady(buildIndex(hexes), { ...hexes[3]!, status: "blessed" }), true);
});

Deno.test("a work hex's pull requests are found through meta.work_hex, newest first", () => {
  const pr = (id: string, work: string) => ({
    ...hex(id, "core.pull_request", "pull_requested"),
    meta: { work_hex: work },
  });
  const idx = buildIndex([
    hex("hx-p-0a1", "core.story", "in_progress"),
    pr("hx-p-0b1", "hx-p-0a1"),
    pr("hx-p-0b2", "hx-p-0a9"),
    pr("hx-p-0b3", "hx-p-0a1"),
  ]);
  assertEquals(pullRequestsOf(idx, "hx-p-0a1").map((h) => h.id), ["hx-p-0b3", "hx-p-0b1"]);
  assertEquals(pullRequestsOf(idx, "hx-p-0zz"), []);
});

Deno.test("a fact is never ready, never waits, and sits under its project", () => {
  const hexes = [
    hex("hx-p-001", "core.project", "in_progress"),
    hex("hx-p-0d1", "core.design", "blocked", ["hx-p-001"]),
    hex("hx-p-0e1", "core.epic", "blocked", ["hx-p-001", "hx-p-0d1"]),
    hex("hx-p-0f1", "core.fact", "known", ["hx-p-001", "hx-p-0d1"]),
    hex("hx-p-0f2", "core.fact", "retired", ["hx-p-001"]),
    hex("hx-p-0a1", "core.story", "blocked", ["hx-p-0f1"]),
    hex("hx-p-0a2", "core.story", "blocked", ["hx-p-0f2"]),
  ];
  const idx = buildIndex(hexes);
  // The design it is about is still blocked; the fact holds regardless, and is never ready.
  assertEquals(isReady(idx, hexes[3]!), false);
  assertEquals(readyHexes(idx).map((h) => h.id), []);
  assertEquals(reconcileReadiness(hexes, ["hx-p-0f1", "hx-p-0f2"], 9), []);
  assertEquals([hexes[3]!.status, hexes[4]!.status], ["known", "retired"]);
  // Known satisfies, retired does not; facts aren't meant as prerequisites, but the table holds.
  assertEquals(reconcileReadiness(hexes, ["hx-p-0a1", "hx-p-0a2"], 10), ["hx-p-0a1"]);
  // A fact about a design still sits under the project, not the design or an epic.
  assertEquals(breadcrumbs(idx, hexes[3]!).map((h) => h.id), ["hx-p-001", "hx-p-0f1"]);
  assertEquals(statusSummary(hexes.slice(3, 5)), "1 known · 1 retired");
});

Deno.test("epics sort in progress → ready → blocked → finished → archived, oldest first", () => {
  const archived = (h: Hex) => ({ ...h, meta: { archived: "2026-01-01T00:00:00Z" } });
  const hexes = [
    // Created in reverse of the expected order so creation order alone cannot pass.
    archived(hex("hx-p-2e0", "core.epic", "in_progress")),
    hex("hx-p-2a1", "core.story", "merged"),
    hex("hx-p-2e1", "core.epic", "blocked", ["hx-p-2a1"]),
    hex("hx-p-2e2", "core.epic", "done"),
    hex("hx-p-2a3", "core.story", "blocked"),
    hex("hx-p-2e3", "core.epic", "blocked", ["hx-p-2a3"]),
    hex("hx-p-2e4", "core.epic", "blocked"),
    hex("hx-p-2a5", "core.story", "ready"),
    hex("hx-p-2e5", "core.epic", "blocked", ["hx-p-2a5", "hx-p-2a3"]),
    hex("hx-p-2e6", "core.epic", "ready"),
    hex("hx-p-2a7", "core.story", "in_review"),
    hex("hx-p-2e7", "core.epic", "blocked", ["hx-p-2a7", "hx-p-2a5"]),
    hex("hx-p-2e8", "core.epic", "in_progress"),
  ];
  const idx = buildIndex(hexes);
  const epics = hexes.filter((h) => h.kind === "core.epic");
  const before = epics.map((e) => e.id);
  assertEquals(sortEpics(idx, epics).map((e) => e.id), [
    "hx-p-2e7", // a story in review
    "hx-p-2e8", // the epic itself in progress, no stories
    "hx-p-2e5", // a ready story
    "hx-p-2e6", // the epic itself ready, no stories
    "hx-p-2e3", // unfinished stories, none ready
    "hx-p-2e4", // blocked, no stories
    "hx-p-2e1", // every story merged
    "hx-p-2e2", // the epic itself done
    "hx-p-2e0", // archived, though still in progress
  ]);
  assertEquals(epics.map((e) => e.id), before, "the input is left unchanged");
});
