import { blurb } from "../src/server/core/service.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { generateId, hashHex } from "../src/server/core/ids.ts";
import { DomainError } from "../src/server/core/errors.ts";
import { HEX_ID_RE } from "../src/shared/schemas.ts";
import { fixture } from "./helpers.ts";

Deno.test("hash is 3 hex chars and deterministic", async () => {
  const a = await hashHex("do a thing", "core.story", 1);
  assertEquals(a, await hashHex("do a thing", "core.story", 1));
  assert(/^[0-9a-f]{3}$/.test(a));
});

Deno.test("a colliding id grows the new hex's hash and leaves createdAt alone", async () => {
  const first = await generateId("foo", "t", "core.story", 100, new Set());
  assertEquals(first, `hx-foo-${await hashHex("t", "core.story", 100)}`);
  const second = await generateId("foo", "t", "core.story", 100, new Set([first]));
  assertEquals(second, `hx-foo-${await hashHex("t", "core.story", 100, 4)}`);
  assert(second.startsWith(first), "longer id extends the shorter one");
  const third = await generateId("foo", "t", "core.story", 100, new Set([first, second]));
  assertEquals(third.length, first.length + 2);
  assert(HEX_ID_RE.test(third));
});

Deno.test("createProject writes the project and selected_project hexes", async () => {
  const f = await fixture();
  try {
    const state = await f.service.state();
    assertEquals(state.dir, f.dir);
    assertEquals(state.selectedProjectId, f.projectId);
    assert(HEX_ID_RE.test(f.projectId));
    assert(f.projectId.startsWith("hx-hexes-"));
    const projects = await f.service.listProjects();
    assertEquals(projects.map((p) => [p.title, p.initial]), [["Hexes Studio", "HS"]]);
    await assertRejects(
      () => f.service.createProject({ dir: f.dir, title: "x", description: "", gitInit: false }),
      DomainError,
      "already has",
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("hexes become ready automatically when their dependencies finish", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const story = await s.createHex({
      projectId: f.projectId,
      kind: "core.story",
      title: "Story",
      description: "",
      status: "blocked",
      requiredBy: [],
      dependsOn: [],
      meta: {},
    });
    const epic = await s.createHex({
      projectId: f.projectId,
      kind: "core.epic",
      title: "Epic",
      description: "",
      status: "blocked",
      requiredBy: [],
      dependsOn: [story.id],
      meta: {},
    });
    await assertRejects(() => s.updateHex(epic.id, { status: "ready" }), DomainError, "not done");
    await s.updateHex(story.id, { status: "done" });
    assertEquals((await s.getHex(epic.id)).status, "ready");
    assertEquals((await s.ready(f.projectId)).map((h) => h.id), [epic.id]);
    await s.updateHex(story.id, { status: "in_progress" });
    assertEquals((await s.getHex(epic.id)).status, "blocked");
  } finally {
    await f.cleanup();
  }
});

Deno.test("requiredBy, cycles and meta rules", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const base = { projectId: f.projectId, description: "", status: "blocked" as const, meta: {} };
    const epic = await s.createHex({
      ...base,
      kind: "core.epic",
      title: "Epic",
      requiredBy: [],
      dependsOn: [],
    });
    const story = await s.createHex({
      ...base,
      kind: "core.story",
      title: "Story",
      requiredBy: [epic.id],
      dependsOn: [],
    });
    assertEquals((await s.getHex(epic.id)).dependsOn, [story.id]);
    await assertRejects(() => s.addDependency(story.id, epic.id), DomainError, "cycle");
    await s.setMeta(story.id, "branch", "main", "add");
    await assertRejects(
      () => s.setMeta(story.id, "branch", "x", "add"),
      DomainError,
      "already exists",
    );
    await assertRejects(
      () => s.setMeta(story.id, "nope", "x", "update"),
      DomainError,
      "does not exist",
    );
    assertEquals((await s.setMeta(story.id, "branch", "dev", "update")).meta, { branch: "dev" });
    assertEquals((await s.removeMeta(story.id, "branch")).meta, undefined);
    await assertRejects(
      () =>
        s.createHex({ ...base, kind: "core.project", title: "P2", requiredBy: [], dependsOn: [] }),
      DomainError,
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("deleting a hex scrubs references; deleting a project cascades", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const base = {
      projectId: f.projectId,
      description: "",
      status: "blocked" as const,
      meta: {},
      requiredBy: [],
    };
    const story = await s.createHex({ ...base, kind: "core.story", title: "Story", dependsOn: [] });
    const epic = await s.createHex({
      ...base,
      kind: "core.epic",
      title: "Epic",
      dependsOn: [story.id],
    });
    const bug = await s.createHex({
      ...base,
      kind: "core.bug",
      title: "Bug",
      dependsOn: [],
      emergedFrom: story.id,
    });
    const view = await s.hexView(story.id);
    assertEquals(view.deleteImpact, { dependents: 1, emerged: 1, projectHexes: null });
    assertEquals(view.breadcrumbs.map((b) => b.kind), ["core.project", "core.epic", "core.story"]);
    await s.deleteHex(story.id);
    assertEquals((await s.getHex(epic.id)).dependsOn, undefined);
    assertEquals((await s.getHex(bug.id)).emergedFrom, undefined);
    const deleted = await s.deleteHex(f.projectId);
    assertEquals(deleted.length, 3);
    assertEquals(await s.listProjects(), []);
  } finally {
    await f.cleanup();
  }
});

Deno.test("project view groups designs, decisions and epics", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const base = {
      projectId: f.projectId,
      description: "",
      status: "done" as const,
      meta: {},
      requiredBy: [],
    };
    await s.createHex({ ...base, kind: "core.design", title: "D", dependsOn: [f.projectId] });
    await s.createHex({ ...base, kind: "core.decision", title: "Dec", dependsOn: [] });
    await s.createHex({ ...base, kind: "core.question", title: "Why?", dependsOn: [] });
    const done = await s.createHex({ ...base, kind: "core.story", title: "S1", dependsOn: [] });
    const open = await s.createHex({
      ...base,
      status: "in_progress",
      kind: "core.story",
      title: "S2",
      dependsOn: [],
    });
    await s.createHex({
      ...base,
      status: "blocked",
      kind: "core.epic",
      title: "E",
      dependsOn: [done.id, open.id],
    });
    const view = await s.projectView(f.projectId);
    assertEquals(
      [view.designs.length, view.decisions.length, view.questions.length, view.epics.length],
      [1, 1, 1, 1],
    );
    assertEquals(view.epics[0]?.progress, { done: 1, total: 2, pct: 50 });
    assertEquals(view.epics[0]?.stories.map((x) => x.title), ["S2", "S1"]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("blurb is a plain-text first sentence, without markdown", () => {
  assertEquals(blurb("A vision."), "A vision.");
  assertEquals(
    blurb("# Title\n\nA **third-person** game with `code` and a [link](http://x.y). More text."),
    "A third-person game with code and a link.",
  );
  assertEquals(blurb("# Only a heading"), "Only a heading");
  assertEquals(blurb("- first item. second"), "first item.");
  assertEquals(blurb("keeps snake_case_names intact."), "keeps snake_case_names intact.");
  assertEquals(blurb(""), "");
});
