import { assertEquals } from "@std/assert";
import { focusFrom, focusHref, spotOf } from "../src/client/lib/project-focus.ts";
import { fixture } from "./helpers.ts";

const base = { description: "", requiredBy: [], meta: {} };

Deno.test("focusHref and focusFrom round-trip a hex id", () => {
  const href = focusHref("hx-p-001", "hx-p-0a1");
  assertEquals(href, "/p/hx-p-001?hex=hx-p-0a1");
  assertEquals(focusFrom(href.slice(href.indexOf("?"))), "hx-p-0a1");
  assertEquals(focusFrom(""), null);
});

Deno.test("spotOf finds where the project page lists each kind of hex", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const make = (kind: string, title: string, dependsOn: string[], status = "blocked") =>
      s.createHex({
        ...base,
        projectId: f.projectId,
        kind,
        title,
        status: status as "blocked",
        dependsOn,
      });
    const idea = await make("core.idea", "Idea", [f.projectId], "draft");
    const design = await make("core.design", "Design", [f.projectId]);
    const spec = await make("core.spec", "Spec", [design.id]);
    const decision = await make("core.decision", "Decision", [design.id]);
    const question = await make("core.question", "Question", [f.projectId], "ready");
    const fact = await make("core.fact", "Fact", [f.projectId], "known");
    const story = await make("core.story", "Story", [spec.id]);
    const loose = await make("core.story", "Loose story", [spec.id]);
    const epic = await make("core.epic", "Epic", [story.id]);
    const gate = await make("core.gate", "Gate", [epic.id]);
    const bug = await make("core.bug", "Bug", [f.projectId]);

    const view = await s.projectView(f.projectId);
    assertEquals(spotOf(view, idea.id), { in: "tab", tab: "ideas" });
    assertEquals(spotOf(view, design.id), { in: "tab", tab: "designs" });
    assertEquals(spotOf(view, spec.id), { in: "tab", tab: "specs" });
    assertEquals(spotOf(view, decision.id), { in: "tab", tab: "decisions" });
    assertEquals(spotOf(view, question.id), { in: "tab", tab: "questions" });
    assertEquals(spotOf(view, fact.id), { in: "facts" });
    assertEquals(spotOf(view, gate.id), { in: "gates" });
    assertEquals(spotOf(view, epic.id), { in: "epic", epicId: epic.id });
    assertEquals(spotOf(view, story.id), { in: "epic", epicId: epic.id });
    // Listed nowhere on the page: Studio opens the hex's own page instead.
    assertEquals(spotOf(view, loose.id), null);
    assertEquals(spotOf(view, bug.id), null);
  } finally {
    await f.cleanup();
  }
});

Deno.test("the project view lists gates in milestone order with their epics' progress", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const make = (kind: string, title: string, dependsOn: string[], status = "blocked") =>
      s.createHex({
        ...base,
        projectId: f.projectId,
        kind,
        title,
        status: status as "blocked",
        dependsOn,
      });
    const first = await make("core.gate", "First", [f.projectId]);
    const story = await make("core.story", "S", [f.projectId], "ready");
    const epic = await make("core.epic", "E", [story.id]);
    const second = await make("core.gate", "Second", [epic.id]);
    await s.updateHex(story.id, { status: "done" });
    await s.updateHex(second.id, { status: "done" });

    const view = await s.projectView(f.projectId);
    assertEquals(
      view.gates.map((g) => [g.hex.title, g.hex.status, g.epics.done, g.epics.total]),
      [["Second", "done", 1, 1], ["First", first.status, 0, 0]],
    );
  } finally {
    await f.cleanup();
  }
});
