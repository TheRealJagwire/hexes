import { assert, assertEquals, assertRejects } from "@std/assert";
import { DomainError } from "../src/server/core/errors.ts";
import { hasRepository } from "../src/shared/graph.ts";
import type { Hex } from "../src/shared/schemas.ts";
import { fixture } from "./helpers.ts";

const base = { description: "", requiredBy: [], meta: {} };

Deno.test("hasRepository: v1 always, v2 once repo_path is set", () => {
  const p = (meta?: Record<string, string>): Hex => ({
    id: "hx-p-001",
    title: "P",
    description: "",
    kind: "core.project",
    status: "done",
    createdAtTimeInMs: 1,
    lastUpdatedAtTimeInMs: 1,
    ...(meta ? { meta } : {}),
  });
  assertEquals(hasRepository(p()), true);
  assertEquals(hasRepository(p({ schema_version: "2" })), false);
  assertEquals(hasRepository(p({ schema_version: "2", repo_path: "/code/p" })), true);
});

Deno.test("a v2 project without a repository holds back its work, not its planning", async () => {
  const f = await fixture("Alpha", { v2: true });
  try {
    const s = f.service;
    // Take the repository away, as a project created without a folder would be.
    await f.workspace.projects.file(f.projectId).mutate((hexes) => {
      delete hexes.find((h) => h.id === f.projectId)!.meta!.repo_path;
    });
    const design = await s.createHex({
      ...base,
      projectId: f.projectId,
      kind: "core.question",
      title: "Which stack?",
      status: "ready",
      dependsOn: [],
    });
    const story = await s.createHex({
      ...base,
      projectId: f.projectId,
      kind: "core.story",
      title: "Build it",
      status: "ready",
      dependsOn: [],
    });
    const ids = async () => (await s.ready(f.projectId)).map((h) => h.id);
    assertEquals(await ids(), [design.id]);
    assertEquals((await s.ready()).map((h) => h.id), [design.id]);
    assertEquals((await s.projectView(f.projectId)).needsRepository, true);
    const err = await assertRejects(() => s.startWork(story.id), DomainError, "repository first");
    assertEquals(err.status, 409);

    // Setting a repository releases the work.
    await f.workspace.projects.file(f.projectId).mutate((hexes) => {
      const p = hexes.find((h) => h.id === f.projectId)!;
      p.meta = { ...p.meta, repo_path: f.dir };
    });
    assertEquals(await ids(), [design.id, story.id]);
    assertEquals((await s.projectView(f.projectId)).needsRepository, false);
  } finally {
    await f.cleanup();
  }
});

Deno.test("a v1 project is never held back", async () => {
  const f = await fixture();
  try {
    const story = await f.service.createHex({
      ...base,
      projectId: f.projectId,
      kind: "core.story",
      title: "Build it",
      status: "ready",
      dependsOn: [],
    });
    assert((await f.service.ready(f.projectId)).some((h) => h.id === story.id));
    assertEquals((await f.service.projectView(f.projectId)).needsRepository, false);
  } finally {
    await f.cleanup();
  }
});
