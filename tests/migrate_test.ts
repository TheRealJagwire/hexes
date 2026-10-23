import { assertEquals } from "@std/assert";
import { migrateStatuses, migrateWorkStatuses } from "../src/server/core/migrate.ts";
import type { Hex, Status } from "../src/shared/schemas.ts";
import { HexService } from "../src/server/core/service.ts";
import { Workspace } from "../src/server/core/workspace.ts";

function hex(id: string, kind: string, status: Status): Hex {
  return {
    id,
    title: id,
    description: "",
    kind,
    status,
    createdAtTimeInMs: 1,
    lastUpdatedAtTimeInMs: 1,
  };
}

Deno.test("ready designs and specs become blessed and done questions answered, once", () => {
  const hexes = [
    hex("hx-p-001", "core.design", "ready"),
    hex("hx-p-002", "core.design", "done"),
    hex("hx-p-003", "core.question", "done"),
    hex("hx-p-004", "core.question", "ready"),
    hex("hx-p-005", "core.story", "ready"),
    hex("hx-p-006", "core.story", "done"),
    hex("hx-p-007", "core.spec", "ready"),
    hex("hx-p-008", "core.spec", "done"),
  ];
  assertEquals(migrateStatuses(hexes, 9), ["hx-p-001", "hx-p-003", "hx-p-007"]);
  assertEquals(hexes.map((h) => h.status), [
    "blessed",
    "done",
    "answered",
    "ready",
    "ready",
    "done",
    "blessed",
    "done",
  ]);
  assertEquals(hexes[0]!.lastUpdatedAtTimeInMs, 9);
  assertEquals(hexes[1]!.lastUpdatedAtTimeInMs, 1);
  assertEquals(migrateStatuses(hexes, 10), [], "a second run changes nothing");
  assertEquals(migrateStatuses([], 10), []);
});

Deno.test("a workspace's data file is migrated on disk the first time it is used", async () => {
  const root = await Deno.makeTempDir({ prefix: "hexes-migrate-" });
  try {
    // A data file written before per-kind statuses: a ready design and a done question.
    const dir = `${root}/old`;
    await Deno.mkdir(`${dir}/.hx`, { recursive: true });
    const path = `${dir}/.hx/data.json`;
    await Deno.writeTextFile(
      path,
      JSON.stringify([
        hex("hx-old-001", "core.project", "done"),
        hex("hx-old-0d1", "core.design", "ready"),
        hex("hx-old-0e1", "core.question", "done"),
        // Waited on the design, which only counts as finished once it is blessed.
        { ...hex("hx-old-0c1", "core.epic", "blocked"), dependsOn: ["hx-old-0d1"] },
        // A spec that was ready is blessed too, which unblocks the story built on it.
        { ...hex("hx-old-0f1", "core.spec", "ready"), dependsOn: ["hx-old-0d1"] },
        { ...hex("hx-old-0a1", "core.story", "blocked"), dependsOn: ["hx-old-0f1"] },
      ]),
    );
    const workspace = new Workspace({ pinnedDir: dir, stateFile: `${root}/state.json` });
    const service = new HexService(workspace);

    assertEquals((await service.getHex("hx-old-0d1")).status, "blessed");
    const onDisk: Hex[] = JSON.parse(await Deno.readTextFile(path));
    assertEquals(onDisk.map((h) => h.status), [
      "done",
      "blessed",
      "answered",
      "ready",
      "blessed",
      "ready",
    ]);
    assertEquals(onDisk.filter((h) => h.kind === "core.decision").length, 0, "no decisions");

    const before = await Deno.stat(path);
    await service.getHex("hx-old-0e1");
    assertEquals((await Deno.stat(path)).mtime, before.mtime, "not rewritten a second time");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function pr(id: string, workHex: string, status: Status): Hex {
  return { ...hex(id, "core.pull_request", status), meta: { work_hex: workHex } };
}

Deno.test("work follows its pull requests: merged, in_review, or back in progress", () => {
  const hexes = [
    hex("hx-p-0a1", "core.story", "done"), // merged PR → merged
    pr("hx-p-0f1", "hx-p-0a1", "merged"),
    hex("hx-p-0a2", "core.bug", "verified"), // merged PR → merged
    pr("hx-p-0f2", "hx-p-0a2", "merged"),
    hex("hx-p-0a3", "core.story", "in_progress"), // open PR → in_review
    pr("hx-p-0f3", "hx-p-0a3", "pull_requested"),
    hex("hx-p-0a4", "x.task", "verified"), // open PR → in_review
    pr("hx-p-0f4", "hx-p-0a4", "pull_requested"),
    hex("hx-p-0a5", "core.substory", "verified"), // no PR → in_progress
    hex("hx-p-0a6", "core.story", "done"), // no PR: stays done
    hex("hx-p-0a7", "core.story", "in_progress"), // closed PR only: unchanged
    pr("hx-p-0f7", "hx-p-0a7", "closed"),
    hex("hx-p-0e1", "core.epic", "verified"), // planning keeps verified
  ];
  assertEquals(migrateWorkStatuses(hexes, 9), [
    "hx-p-0a1",
    "hx-p-0a2",
    "hx-p-0a3",
    "hx-p-0a4",
    "hx-p-0a5",
  ]);
  const status = Object.fromEntries(hexes.map((h) => [h.id, h.status]));
  assertEquals(
    [
      status["hx-p-0a1"],
      status["hx-p-0a2"],
      status["hx-p-0a3"],
      status["hx-p-0a4"],
      status["hx-p-0a5"],
      status["hx-p-0a6"],
      status["hx-p-0a7"],
      status["hx-p-0e1"],
    ],
    [
      "merged",
      "merged",
      "in_review",
      "in_review",
      "in_progress",
      "done",
      "in_progress",
      "verified",
    ],
  );
  assertEquals(migrateWorkStatuses(hexes, 10), [], "a second run changes nothing");
});

Deno.test("migrating work re-checks what waits on it", () => {
  const waiting = { ...hex("hx-p-0b1", "core.story", "ready"), dependsOn: ["hx-p-0a1"] };
  const hexes = [hex("hx-p-0a1", "core.story", "verified"), waiting];
  // `verified` never satisfied, so a ready dependent was already wrong; it drops back to blocked.
  migrateWorkStatuses(hexes, 9);
  assertEquals(hexes[0]!.status, "in_progress");
  assertEquals(hexes[1]!.status, "blocked");
});
