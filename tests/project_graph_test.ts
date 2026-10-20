import { assertEquals, assertRejects } from "@std/assert";
import { DomainError } from "../src/server/core/errors.ts";
import { HexService } from "../src/server/core/service.ts";
import { Workspace } from "../src/server/core/workspace.ts";
import { createApp } from "../src/server/app.ts";
import type { Hex } from "../src/shared/schemas.ts";

function hex(id: string, kind: string, created: number, dependsOn: string[] = []): Hex {
  return {
    id,
    title: id,
    description: `About ${id}. More detail.`,
    kind,
    status: "done",
    createdAtTimeInMs: created,
    lastUpdatedAtTimeInMs: created,
    ...(dependsOn.length ? { dependsOn } : {}),
  };
}

/** Two projects in one data file, with a link from one into the other. */
async function workspace(): Promise<{ service: HexService; cleanup: () => Promise<void> }> {
  const root = await Deno.makeTempDir({ prefix: "hexes-graph-" });
  const dir = `${root}/ws`;
  await Deno.mkdir(`${dir}/.hx`, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/.hx/data.json`,
    JSON.stringify([
      // Created after its own hexes, to show the project still comes first.
      hex("hx-a-001", "core.project", 50),
      { ...hex("hx-a-0d1", "core.design", 2, ["hx-a-001"]), meta: { git_branch: "x" } },
      hex("hx-a-0f1", "core.story", 1, ["hx-a-0d1", "hx-b-0d1"]),
      hex("hx-b-001", "core.project", 3),
      hex("hx-b-0d1", "core.design", 4, ["hx-b-001"]),
      hex("hx-studio-001", "studio.selected_project", 5),
    ]),
  );
  const ws = new Workspace({ pinnedDir: dir, stateFile: `${root}/state.json` });
  return {
    service: new HexService(ws),
    cleanup: () => Deno.remove(root, { recursive: true }),
  };
}

Deno.test("a project graph holds its own hexes, project first, and links within it", async () => {
  const { service, cleanup } = await workspace();
  try {
    const g = await service.projectGraph("hx-a-001");
    assertEquals(g.projectId, "hx-a-001");
    assertEquals(g.nodes.map((n) => n.id), ["hx-a-001", "hx-a-0f1", "hx-a-0d1"]);
    assertEquals(g.edges, [
      { from: "hx-a-0f1", to: "hx-a-0d1" },
      { from: "hx-a-0d1", to: "hx-a-001" },
    ]);
    assertEquals(g.nodes[2], {
      id: "hx-a-0d1",
      title: "hx-a-0d1",
      kind: "core.design",
      status: "done",
      blurb: "About hx-a-0d1.",
      gitBranch: "x",
      updatedAt: 2,
    });
    assertEquals(g.nodes[1]?.gitBranch, null);
  } finally {
    await cleanup();
  }
});

Deno.test("a project graph needs a project", async () => {
  const { service, cleanup } = await workspace();
  try {
    await assertRejects(() => service.projectGraph("hx-a-999"), DomainError, "No project");
    const notProject = await service.projectGraph("hx-a-0d1").catch((e) => e);
    assertEquals([notProject instanceof DomainError, notProject.status], [true, 422]);

    const res = await createApp(service).request("/api/projects/hx-b-001/graph", {
      headers: { host: "localhost:8000" },
    });
    assertEquals(res.status, 200);
    assertEquals((await res.json()).nodes.length, 2);
  } finally {
    await cleanup();
  }
});
