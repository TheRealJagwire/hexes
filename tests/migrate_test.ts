import { assertEquals } from "@std/assert";
import { migrateStatuses } from "../src/server/core/migrate.ts";
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

Deno.test("ready designs become blessed and done questions answered, once", () => {
  const hexes = [
    hex("hx-p-001", "core.design", "ready"),
    hex("hx-p-002", "core.design", "done"),
    hex("hx-p-003", "core.question", "done"),
    hex("hx-p-004", "core.question", "ready"),
    hex("hx-p-005", "core.story", "ready"),
    hex("hx-p-006", "core.story", "done"),
  ];
  assertEquals(migrateStatuses(hexes, 9), ["hx-p-001", "hx-p-003"]);
  assertEquals(hexes.map((h) => h.status), [
    "blessed",
    "done",
    "answered",
    "ready",
    "ready",
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
      ]),
    );
    const workspace = new Workspace({ pinnedDir: dir, stateFile: `${root}/state.json` });
    const service = new HexService(workspace);

    assertEquals((await service.getHex("hx-old-0d1")).status, "blessed");
    const onDisk: Hex[] = JSON.parse(await Deno.readTextFile(path));
    assertEquals(onDisk.map((h) => h.status), ["done", "blessed", "answered"]);
    assertEquals(onDisk.filter((h) => h.kind === "core.decision").length, 0, "no decisions");

    const before = await Deno.stat(path);
    await service.getHex("hx-old-0e1");
    assertEquals((await Deno.stat(path)).mtime, before.mtime, "not rewritten a second time");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
