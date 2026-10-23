import { assert, assertEquals } from "@std/assert";
import {
  DEFAULT_WORKFLOW,
  DERIVED,
  KIND_WORKFLOWS,
  type Status,
  STATUS_INFO,
  STATUSES,
  workflowOf,
} from "../src/shared/constants.ts";
import { createApp } from "../src/server/app.ts";
import { fixture } from "./helpers.ts";

const workflows = () => [["default", DEFAULT_WORKFLOW] as const, ...Object.entries(KIND_WORKFLOWS)];

Deno.test("every workflow ends terminal, promotes within itself and can block what waits", () => {
  for (const [kind, wf] of workflows()) {
    // An actionable hex drops back to blocked when a dependency reopens.
    if (wf.statuses.some((s) => STATUS_INFO[s].role === "actionable")) {
      assert(wf.statuses.includes("blocked"), `${kind} can be blocked`);
    }
    assert(
      wf.statuses.some((s) => STATUS_INFO[s].role === "terminal"),
      `${kind} has a terminal status`,
    );
    assert(wf.promoteTo === null || wf.statuses.includes(wf.promoteTo), `${kind} promoteTo`);
    for (const s of wf.statuses) assert(STATUSES.includes(s), `${kind}: ${s} is a status`);
  }
});

Deno.test("only finished or approved statuses satisfy dependents", () => {
  for (const s of STATUSES) {
    const { role, satisfies } = STATUS_INFO[s];
    if (role === "waiting" || role === "active") assert(!satisfies, `${s} should not satisfy`);
  }
  // A closed pull request is finished but abandoned: the work it was for is not done.
  assertEquals(STATUS_INFO.closed, { role: "terminal", satisfies: false });
  assertEquals(STATUS_INFO.merged, { role: "terminal", satisfies: true });
});

Deno.test("pull-request statuses belong to pull requests, and merged to work too", () => {
  const pr = workflowOf("core.pull_request").statuses;
  assertEquals(pr, ["pull_requested", "merged", "closed"]);
  for (const [kind, wf] of workflows()) {
    if (kind === "core.pull_request") continue;
    for (const s of ["pull_requested", "closed"] as const) {
      assert(!wf.statuses.includes(s), `${kind} must not allow ${s}`);
    }
  }
  assertEquals(DERIVED, ["in_review", "merged"]);
  assertEquals(STATUS_INFO.in_review, { role: "active", satisfies: false });
});

Deno.test("work kinds follow pull requests; planning kinds are checked by hand", () => {
  const work: Status[] = ["blocked", "ready", "in_progress", "in_review", "merged", "done"];
  const planning: Status[] = ["blocked", "ready", "in_progress", "verified", "done"];
  for (const kind of ["core.story", "core.substory", "core.bug", "x.task"]) {
    assertEquals(workflowOf(kind).statuses, work, kind);
  }
  for (const kind of ["core.project", "core.epic", "core.gate", "core.decision"]) {
    assertEquals(workflowOf(kind).statuses, planning, kind);
  }
});

Deno.test("GET /api/statuses serves the status table", async () => {
  const f = await fixture();
  try {
    const res = await createApp(f.service).request("/api/statuses", {
      headers: { host: "localhost:8000" },
    });
    const table = await res.json();
    assertEquals(res.status, 200);
    assertEquals(table.statuses, STATUS_INFO);
    assertEquals(table.kinds, KIND_WORKFLOWS);
    assertEquals(table.default, DEFAULT_WORKFLOW);
    assertEquals(table.requiresResponse, ["answered"]);
    assertEquals(table.derived, ["in_review", "merged"]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("PATCH /api/hexes/:id answers a question only with a response", async () => {
  const f = await fixture();
  try {
    const app = createApp(f.service);
    const call = async (method: string, path: string, body: unknown) => {
      const res = await app.request(`/api${path}`, {
        method,
        headers: { host: "localhost:8000", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: res.status, json: await res.json() };
    };
    const q = await call("POST", "/hexes", {
      projectId: f.projectId,
      kind: "core.question",
      title: "Why?",
    });
    const refused = await call("PATCH", `/hexes/${q.json.id}`, { status: "answered" });
    assertEquals([refused.status, refused.json.error], [422, "An answer needs a response"]);
    const ok = await call("PATCH", `/hexes/${q.json.id}`, {
      status: "answered",
      response: "Because.",
    });
    assertEquals([ok.status, ok.json.status, ok.json.meta.answer], [200, "answered", "Because."]);
  } finally {
    await f.cleanup();
  }
});
