import { createApp } from "../src/server/app.ts";
import { blurb } from "../src/server/core/service.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { generateId, hashHex } from "../src/server/core/ids.ts";
import { DomainError } from "../src/server/core/errors.ts";
import { HEX_ID_RE } from "../src/shared/schemas.ts";
import { type Fixture, fixture } from "./helpers.ts";

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

Deno.test("a v1 fixture project is selected in its folder", async () => {
  const f = await fixture();
  try {
    const state = await f.service.state();
    assertEquals([state.dir, state.selectedProjectId, state.schemaVersion], [
      f.dir,
      f.projectId,
      1,
    ]);
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

Deno.test("createProject writes a v2 project under ~/.hx and leaves the repo clean", async () => {
  const f = await fixture("Hexes Studio", { v2: true });
  try {
    const s = f.service;
    const file = f.workspace.projects.projectFile(f.projectId);
    const hexes = JSON.parse(await Deno.readTextFile(file));
    assertEquals(hexes.length, 1, "only the project hex");
    assertEquals([hexes[0].id, hexes[0].kind, hexes[0].meta], [f.projectId, "core.project", {
      schema_version: "2",
      repo_path: f.dir,
    }]);
    assertEquals((await Deno.stat(f.dir)).isDirectory, true);
    await assertRejects(() => Deno.stat(`${f.dir}/.hx`), Deno.errors.NotFound);

    const state = await s.state();
    assertEquals([state.selectedProjectId, state.schemaVersion, state.repoPath], [
      f.projectId,
      2,
      f.dir,
    ]);
    const [recent] = await f.workspace.recentProjects();
    assertEquals([recent?.projectId, recent?.dir], [f.projectId, undefined]);

    // The same folder cannot become a second project's repo.
    const again = await assertRejects(
      () => s.createProject({ dir: f.dir, title: "Again", description: "", gitInit: false }),
      DomainError,
      "already the repo",
    );
    assertEquals(again.status, 409);

    // Another title with the same leading word gets a fresh prefix.
    const { projectId: other } = await s.createProject({
      dir: `${f.dir}-2`,
      title: "Hexes Two",
      description: "",
      gitInit: false,
    });
    assert(other.startsWith("hx-hexes2-"), other);
    assertEquals(await s.selectedProjectId(), other);
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
    assertEquals(view.deleteImpact, {
      dependents: 1,
      emerged: 1,
      projectHexes: null,
      pullRequests: 0,
    });
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

Deno.test("project view groups designs, specs, decisions, questions and epics", async () => {
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
    assertEquals((await s.projectView(f.projectId)).specs, []);
    const design = await s.createHex({
      ...base,
      kind: "core.design",
      title: "D",
      dependsOn: [f.projectId],
    });
    await s.createHex({ ...base, kind: "core.spec", title: "Sp", dependsOn: [design.id] });
    await s.createHex({ ...base, kind: "core.decision", title: "Dec", dependsOn: [] });
    await s.createHex({
      ...base,
      status: "blocked",
      kind: "core.question",
      title: "Why?",
      dependsOn: [],
    });
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
    assertEquals(view.specs.map((x) => [x.title, x.kind]), [["Sp", "core.spec"]]);
    assertEquals(view.epics[0]?.progress, { done: 1, total: 2, pct: 50 });
    assertEquals(view.epics[0]?.stories.map((x) => x.title), ["S2", "S1"]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("project view lists the most active epics first and archived ones last", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const base = { projectId: f.projectId, description: "", meta: {}, requiredBy: [] };
    const story = (title: string, status: "done" | "blocked" | "ready" | "in_progress") =>
      s.createHex({ ...base, kind: "core.story", title, status, dependsOn: [] });
    const epic = (title: string, dependsOn: string[], status: "blocked" | "done" = "blocked") =>
      s.createHex({ ...base, kind: "core.epic", title, status, dependsOn });
    // Created finished-first, the reverse of the order the view should show.
    const archived = await epic("Archived", [(await story("A1", "in_progress")).id]);
    await s.setMeta(archived.id, "archived", "2026-01-01T00:00:00Z");
    await epic("Finished", [(await story("F1", "done")).id]);
    await epic("Blocked", [(await story("B1", "blocked")).id]);
    await epic("Ready", [(await story("R1", "ready")).id]);
    await epic("Active", [(await story("P1", "in_progress")).id]);
    const view = await s.projectView(f.projectId);
    assertEquals(view.epics.map((e) => e.hex.title), [
      "Active",
      "Ready",
      "Blocked",
      "Finished",
      "Archived",
    ]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("ideas start as drafts, are published by people and list newest first", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const base = { description: "", requiredBy: [], meta: {}, projectId: f.projectId };
    const idea = (title: string, status: "draft" | "published" | "done" = "draft") =>
      s.createHex({ ...base, kind: "core.idea", title, status, dependsOn: [f.projectId] });
    await assertRejects(() => idea("Too soon", "published"), DomainError, "starts as a draft");
    await assertRejects(() => idea("Too late", "done"), DomainError, "starts as a draft");
    await assertRejects(
      () =>
        s.createHex({ ...base, kind: "core.story", title: "x", status: "draft", dependsOn: [] }),
      DomainError,
      "cannot be draft",
    );

    // The project is still in progress: that doesn't hold an idea back.
    await s.updateHex(f.projectId, { status: "in_progress" });
    const first = await idea("First");
    const second = await idea("Second");
    assertEquals((await s.ready(f.projectId)).map((h) => h.id), []);
    await assertRejects(
      () => s.updateHex(first.id, { status: "ready" }),
      DomainError,
      "cannot be ready; use published",
    );
    await s.updateHex(first.id, { status: "published" });
    assertEquals((await s.ready(f.projectId)).map((h) => h.id), [first.id]);
    await s.updateHex(f.projectId, { status: "blocked" });
    assertEquals((await s.getHex(first.id)).status, "published", "never demoted");

    // A design built on a published idea is held back only by the project.
    await s.updateHex(f.projectId, { status: "done" });
    const design = await s.createHex({
      ...base,
      kind: "core.design",
      title: "Design it",
      status: "blocked",
      dependsOn: [f.projectId, first.id],
      emergedFrom: first.id,
    });
    await s.updateHex(design.id, { status: "blessed" });

    // Back to draft, then closed: both are free moves.
    await s.updateHex(first.id, { status: "draft" });
    await s.updateHex(first.id, { status: "done" });
    await s.updateHex(first.id, { status: "published" });
    assertEquals(
      (await s.projectView(f.projectId)).ideas.map((x) => [x.title, x.status]),
      [["Second", "draft"], ["First", "published"]],
    );
    assertEquals(second.status, "draft");
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

Deno.test("designs are blessed, not ready, and blessing unblocks what depends on them", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const base = { description: "", requiredBy: [], meta: {} };
    const gate = await s.createHex({
      ...base,
      projectId: f.projectId,
      kind: "core.story",
      title: "Prerequisite",
      status: "blocked",
      dependsOn: [],
    });
    const design = await s.createHex({
      ...base,
      projectId: f.projectId,
      kind: "core.design",
      title: "Design",
      status: "blocked",
      dependsOn: [gate.id],
    });
    const spec = await s.createHex({
      ...base,
      projectId: f.projectId,
      kind: "core.decision",
      title: "Decision",
      status: "blocked",
      dependsOn: [design.id],
    });
    await assertRejects(
      () => s.updateHex(design.id, { status: "ready" }),
      DomainError,
      "cannot be ready; use blessed",
    );
    await assertRejects(
      () => s.updateHex(design.id, { status: "blessed" }),
      DomainError,
      "not done",
    );
    await s.updateHex(gate.id, { status: "done" });
    assertEquals((await s.getHex(design.id)).status, "blocked", "never blessed automatically");

    await s.updateHex(design.id, { status: "blessed" });
    assertEquals((await s.getHex(spec.id)).status, "ready");
    assertEquals((await s.ready(f.projectId)).map((h) => h.id), [design.id, spec.id]);

    await s.updateHex(design.id, { status: "in_progress" });
    assertEquals((await s.getHex(spec.id)).status, "blocked");
    await s.updateHex(design.id, { status: "done" });
    assertEquals((await s.getHex(spec.id)).status, "ready");
  } finally {
    await f.cleanup();
  }
});

Deno.test("specs are blessed like designs, and only blessing unblocks work built on them", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const base = { description: "", requiredBy: [], meta: {}, projectId: f.projectId };
    const design = await s.createHex({
      ...base,
      kind: "core.design",
      title: "Design",
      status: "blocked",
      dependsOn: [f.projectId],
    });
    const spec = await s.createHex({
      ...base,
      kind: "core.spec",
      title: "Spec",
      status: "blocked",
      dependsOn: [design.id],
    });
    const story = await s.createHex({
      ...base,
      kind: "core.story",
      title: "Story",
      status: "blocked",
      dependsOn: [spec.id],
    });
    await assertRejects(
      () => s.updateHex(spec.id, { status: "ready" }),
      DomainError,
      "cannot be ready; use blessed",
    );
    await assertRejects(() => s.updateHex(spec.id, { status: "blessed" }), DomainError, "not done");

    await s.updateHex(design.id, { status: "blessed" });
    assertEquals((await s.getHex(spec.id)).status, "blocked", "never blessed automatically");
    await s.updateHex(spec.id, { status: "in_progress" });
    assertEquals((await s.getHex(story.id)).status, "blocked", "a draft does not unblock work");

    await s.updateHex(spec.id, { status: "blessed" });
    assertEquals((await s.getHex(story.id)).status, "ready");
    await s.updateHex(spec.id, { status: "in_progress" });
    assertEquals((await s.getHex(story.id)).status, "blocked", "reopening re-blocks");
  } finally {
    await f.cleanup();
  }
});

Deno.test("answering a question needs a response and records it as a decision", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const base = { description: "", requiredBy: [], meta: {} };
    const design = await s.createHex({
      ...base,
      projectId: f.projectId,
      kind: "core.design",
      title: "Design",
      status: "blocked",
      dependsOn: [],
    });
    const question = await s.createHex({
      ...base,
      projectId: f.projectId,
      kind: "core.question",
      title: "Which database?",
      status: "ready",
      dependsOn: [design.id],
    }).catch(() => null);
    assertEquals(question, null, "ready needs the design blessed first");
    await s.updateHex(design.id, { status: "blessed" });
    const q = await s.createHex({
      ...base,
      projectId: f.projectId,
      kind: "core.question",
      title: "Which database?",
      status: "ready",
      dependsOn: [design.id],
    });
    const story = await s.createHex({
      ...base,
      projectId: f.projectId,
      kind: "core.story",
      title: "Pick storage",
      status: "blocked",
      dependsOn: [q.id],
    });

    await assertRejects(
      () => s.updateHex(q.id, { status: "done" }),
      DomainError,
      "cannot be done; use answered",
    );
    await assertRejects(
      () => s.updateHex(q.id, { status: "answered" }),
      DomainError,
      "needs a response",
    );
    await assertRejects(
      () => s.updateHex(q.id, { status: "answered", response: "   " }),
      DomainError,
      "needs a response",
    );
    await assertRejects(
      () => s.updateHex(story.id, { status: "in_progress", response: "x" }),
      DomainError,
      "only given when answering",
    );
    await assertRejects(
      () =>
        s.createHex({
          ...base,
          projectId: f.projectId,
          kind: "core.question",
          title: "Pre-answered",
          status: "answered",
          dependsOn: [],
        }),
      DomainError,
      "with a response",
    );
    assertEquals((await s.search({ kind: "core.decision" })).length, 0, "refusals write nothing");

    const answered = await s.updateHex(q.id, { status: "answered", response: "  Postgres.  " });
    assertEquals(answered.status, "answered");
    assertEquals(answered.meta?.answer, "Postgres.");
    const decision = await s.getHex(answered.meta!.decision!);
    assertEquals(decision.kind, "core.decision");
    assertEquals(decision.status, "done");
    assertEquals(decision.title, "Decision: Which database?");
    assert(decision.description.startsWith("Postgres."));
    assertEquals(decision.emergedFrom, q.id);
    assertEquals(decision.dependsOn, [design.id]);
    assertEquals((await s.hexView(q.id)).emergedHere.map((h) => h.id), [decision.id]);

    const after = await s.getHex(story.id);
    assertEquals(after.status, "ready", "answered unblocks dependents");
    assertEquals(after.dependsOn, [q.id, decision.id]);

    await assertRejects(
      () => s.updateHex(q.id, { status: "answered", response: "MySQL" }),
      DomainError,
      "already answered",
    );
    await s.updateHex(q.id, { status: "in_progress" });
    await assertRejects(
      () => s.updateHex(q.id, { status: "answered", response: "MySQL" }),
      DomainError,
      "already answered",
    );
    assertEquals((await s.search({ kind: "core.decision" })).length, 1);
  } finally {
    await f.cleanup();
  }
});

Deno.test("a question with no design records its decision under the project", async () => {
  const f = await fixture();
  try {
    const q = await f.service.createHex({
      projectId: f.projectId,
      kind: "core.question",
      title: "Q",
      description: "",
      status: "ready",
      requiredBy: [],
      dependsOn: [],
      meta: {},
    });
    const answered = await f.service.updateHex(q.id, { status: "answered", response: "Yes" });
    assertEquals((await f.service.getHex(answered.meta!.decision!)).dependsOn, [f.projectId]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("pull requests are only opened, never created directly", async () => {
  const f = await fixture();
  try {
    await assertRejects(
      () =>
        f.service.createHex({
          projectId: f.projectId,
          kind: "core.pull_request",
          title: "PR",
          description: "",
          status: "pull_requested",
          requiredBy: [],
          dependsOn: [],
          meta: {},
        }),
      DomainError,
      "opening one on a work hex",
    );
    const story = await f.service.createHex({
      projectId: f.projectId,
      kind: "core.story",
      title: "S",
      description: "",
      status: "blocked",
      requiredBy: [],
      dependsOn: [],
      meta: {},
    });
    await assertRejects(
      () => f.service.updateHex(story.id, { status: "merged" }),
      DomainError,
      "merged is set by merging its pull request",
    );
    const epic = await f.service.createHex({
      projectId: f.projectId,
      kind: "core.epic",
      title: "E",
      description: "",
      status: "blocked",
      requiredBy: [],
      dependsOn: [],
      meta: {},
    });
    await assertRejects(
      () => f.service.updateHex(epic.id, { status: "merged" }),
      DomainError,
      "cannot be merged",
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("facts start known, list newest first, and sit apart from a hex's dependents", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const base = { description: "", requiredBy: [], meta: {}, projectId: f.projectId };
    const design = await s.createHex({
      ...base,
      kind: "core.design",
      title: "D",
      status: "blocked",
      dependsOn: [f.projectId],
    });
    const story = await s.createHex({
      ...base,
      kind: "core.story",
      title: "S",
      status: "blocked",
      dependsOn: [design.id],
    });
    const fact = (title: string, status: "known" | "retired" = "known") =>
      s.createHex({
        ...base,
        kind: "core.fact",
        title,
        status,
        dependsOn: [f.projectId, design.id],
      });
    await assertRejects(() => fact("Gone already", "retired"), DomainError, "starts as known");
    await assertRejects(
      () =>
        s.createHex({ ...base, kind: "core.fact", title: "x", status: "blocked", dependsOn: [] }),
      DomainError,
      "cannot be blocked",
    );
    await assertRejects(
      () =>
        s.createHex({ ...base, kind: "core.story", title: "x", status: "known", dependsOn: [] }),
      DomainError,
      "cannot be known",
    );

    const first = await fact("Channels must be stdio");
    const second = await fact("A gate depends on its epics");
    // The design it is about is still blocked; the fact holds anyway.
    assertEquals((await s.getHex(first.id)).status, "known");

    const view = await s.hexView(design.id);
    assertEquals(view.dependedOnBy.map((h) => h.id), [story.id]);
    assertEquals(view.facts.map((h) => h.id), [second.id, first.id]);
    assertEquals(view.deleteImpact.dependents, 3);
    assertEquals((await s.hexView(first.id)).dependsOn.map((h) => h.id), [f.projectId, design.id]);
    assertEquals((await s.hexView(first.id)).breadcrumbs.map((h) => h.id), [f.projectId, first.id]);

    // Retired and restored freely; the project view lists both, newest first.
    await s.updateHex(first.id, { status: "retired" });
    assertEquals(
      (await s.projectView(f.projectId)).facts.map((x) => [x.title, x.status]),
      [["A gate depends on its epics", "known"], ["Channels must be stdio", "retired"]],
    );
    assertEquals((await s.updateHex(first.id, { status: "known" })).status, "known");
    await assertRejects(() => s.startWork(first.id), DomainError, "not worked on a branch");
    assertEquals((await s.ready(f.projectId)).some((h) => h.kind === "core.fact"), false);
  } finally {
    await f.cleanup();
  }
});

Deno.test("facts() filters by nearness, file, title and status, and orders the hits", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const base = { description: "", requiredBy: [], meta: {}, projectId: f.projectId };
    const make = (kind: string, title: string, dependsOn: string[], meta = {}) =>
      s.createHex({
        ...base,
        kind,
        title,
        status: kind === "core.fact" ? "known" : "blocked",
        dependsOn,
        meta,
      });
    const design = await make("core.design", "Design", [f.projectId]);
    const story = await make("core.story", "Story", [design.id]);
    const aboutDesign = await make(
      "core.fact",
      "Channels must be stdio",
      [f.projectId, design.id],
      {
        files: "src/mcp/channel.ts, src/mcp/build.ts",
      },
    );
    const aboutStory = await make("core.fact", "Stories depend on their design", [
      f.projectId,
      story.id,
    ]);
    const loose = await make("core.fact", "Android must tolerate unknown statuses", [f.projectId]);
    const old = await make("core.fact", "Channels may use HTTP", [f.projectId, design.id]);
    await s.updateHex(old.id, { status: "retired" });
    const ids = async (q: Parameters<typeof s.facts>[1]) =>
      (await s.facts(f.projectId, q)).facts.map((h) => h.fact.id);

    // Near the story: its own fact first, then the design's, with the path that reached it.
    const nearStory = await s.facts(f.projectId, { near: story.id });
    assertEquals(nearStory.facts.map((h) => [h.fact.id, h.distance]), [
      [aboutStory.id, 1],
      [aboutDesign.id, 2],
    ]);
    assertEquals(nearStory.facts[1]!.path.map((p) => p.id), [story.id, design.id, aboutDesign.id]);
    assertEquals(await ids({ near: story.id, depth: 1 }), [aboutStory.id]);
    assertEquals(await ids({ near: story.id, includeRetired: true }), [
      aboutStory.id,
      old.id,
      aboutDesign.id,
    ]);

    // No near: every known fact, newest first, without distance or path.
    const all = await s.facts(f.projectId);
    assertEquals(all.facts.map((h) => h.fact.id), [loose.id, aboutStory.id, aboutDesign.id]);
    assertEquals([all.facts[0]!.distance, all.facts[0]!.path], [null, []]);

    assertEquals(await ids({ file: "./src/mcp/build.ts" }), [aboutDesign.id]);
    assertEquals(await ids({ file: "src/mcp" }), []);
    assertEquals(await ids({ query: "chan" }), [aboutDesign.id]);
    assertEquals(await ids({ query: "chan", includeRetired: true }), [old.id, aboutDesign.id]);
    // Filters combine.
    assertEquals(await ids({ near: story.id, query: "stories" }), [aboutStory.id]);
    assertEquals(await ids({ near: story.id, file: "src/mcp/channel.ts", depth: 1 }), []);

    await assertRejects(() => s.facts(f.projectId, { depth: 5 }), DomainError, "1 to 4");
    await assertRejects(() => s.facts(f.projectId, { depth: 0 }), DomainError, "1 to 4");
    await assertRejects(() => s.facts(f.projectId, { near: "hx-nope-123" }), DomainError, "No hex");
    await assertRejects(() => s.facts(design.id), DomainError, "No project");
  } finally {
    await f.cleanup();
  }
});

Deno.test("GET /api/projects/:id/facts serves facts() with its query parameters", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const base = { description: "", requiredBy: [], meta: {}, projectId: f.projectId };
    const design = await s.createHex({
      ...base,
      kind: "core.design",
      title: "D",
      status: "blocked",
      dependsOn: [f.projectId],
    });
    const fact = await s.createHex({
      ...base,
      kind: "core.fact",
      title: "Channels must be stdio",
      status: "known",
      dependsOn: [f.projectId, design.id],
      meta: { files: "src/mcp/channel.ts" },
    });
    const retired = await s.createHex({
      ...base,
      kind: "core.fact",
      title: "Old",
      status: "known",
      dependsOn: [f.projectId],
    });
    await s.updateHex(retired.id, { status: "retired" });
    const app = createApp(s);
    const get = async (qs: string) => {
      const res = await app.request(`/api/projects/${f.projectId}/facts${qs}`, {
        headers: { host: "localhost:8000" },
      });
      return { status: res.status, json: await res.json() };
    };
    const near = await get(`?near=${design.id}&depth=1`);
    assertEquals(near.status, 200);
    assertEquals(near.json.facts.map((h: { fact: { id: string } }) => h.fact.id), [fact.id]);
    assertEquals(near.json.facts[0].distance, 1);
    assertEquals((await get("?file=src/mcp/channel.ts&query=stdio")).json.facts.length, 1);
    assertEquals((await get("")).json.facts.length, 1);
    assertEquals((await get("?include_retired=1")).json.facts.length, 2);
    assertEquals((await get("?depth=9")).status, 422);
    assertEquals((await get("?near=hx-nope-123")).status, 404);
  } finally {
    await f.cleanup();
  }
});

/** Seeds a schema-v2 project straight into the fixture's ~/.hx stand-in. */
async function seedV2(f: Fixture, id: string, title: string, repo: string): Promise<void> {
  await f.workspace.projects.file(id).mutate((hexes) => {
    hexes.push({
      id,
      title,
      description: "",
      kind: "core.project",
      status: "done",
      createdAtTimeInMs: 1,
      lastUpdatedAtTimeInMs: 1,
      meta: { schema_version: "2", repo_path: repo },
    });
  }, { create: true });
}

Deno.test("a v2 project is selected by id in state.json, never by a selected-project hex", async () => {
  const f = await fixture("Alpha");
  try {
    const s = f.service;
    await seedV2(f, "hx-beta-0b1", "Beta", "/code/beta");
    await s.selectProject("hx-beta-0b1");

    const state = await s.state();
    assertEquals(
      [state.selectedProjectId, state.schemaVersion, state.repoPath, state.dir],
      ["hx-beta-0b1", 2, "/code/beta", "/code/beta"],
    );
    assertEquals(await s.selectedProjectId(), "hx-beta-0b1");
    const saved = JSON.parse(await Deno.readTextFile(f.workspace.stateFile));
    assertEquals(saved.selectedProjectId, "hx-beta-0b1");
    const v2 = await f.workspace.projects.file("hx-beta-0b1").read();
    assertEquals(v2.filter((h) => h.kind.startsWith("studio.")), []);

    // Reads and writes now go to the v2 file.
    const created = await s.createHex({
      projectId: "hx-beta-0b1",
      kind: "core.design",
      title: "Beta design",
      description: "",
      status: "blocked",
      requiredBy: [],
      dependsOn: ["hx-beta-0b1"],
      meta: {},
    });
    assertEquals(
      (await f.workspace.projects.file("hx-beta-0b1").read()).some((h) => h.id === created.id),
      true,
    );

    // The recent entry for a v2 project has no folder.
    const [recent] = await s.recentProjects();
    assertEquals(
      [recent?.projectId, recent?.dir, recent?.current, recent?.needsMigration],
      ["hx-beta-0b1", "/code/beta", true, false],
    );

    // Selecting the v1 project goes back to its folder.
    await s.selectProject(f.projectId);
    const back = await s.state();
    assertEquals([back.selectedProjectId, back.schemaVersion, back.dir], [
      f.projectId,
      1,
      f.dir,
    ]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("listProjects shows v2 projects, then v1 ones marked as needing migration", async () => {
  const f = await fixture("Alpha");
  try {
    await seedV2(f, "hx-beta-0b1", "Beta", "/code/beta");
    const list = await f.service.listProjects();
    assertEquals(list.map((p) => [p.title, p.needsMigration]), [["Beta", false], [
      "Alpha",
      true,
    ]]);
  } finally {
    await f.cleanup();
  }
});
