import { assert, assertEquals } from "@std/assert";
import {
  DEFAULT_WORKFLOW,
  KIND_WORKFLOWS,
  STATUS_INFO,
  STATUSES,
  workflowOf,
} from "../src/shared/constants.ts";
import { createApp } from "../src/server/app.ts";
import { fixture } from "./helpers.ts";

const workflows = () => [["default", DEFAULT_WORKFLOW] as const, ...Object.entries(KIND_WORKFLOWS)];

Deno.test("every workflow starts blocked, ends terminal and promotes within itself", () => {
  for (const [kind, wf] of workflows()) {
    assert(wf.statuses.includes("blocked"), `${kind} can be blocked`);
    assert(
      wf.statuses.some((s) => STATUS_INFO[s].role === "terminal"),
      `${kind} has a terminal status`,
    );
    assert(wf.promoteTo === null || wf.statuses.includes(wf.promoteTo), `${kind} promoteTo`);
    for (const s of wf.statuses) assert(STATUSES.includes(s), `${kind}: ${s} is a status`);
  }
});

Deno.test("terminal statuses satisfy dependents and nothing waiting or active does", () => {
  for (const s of STATUSES) {
    const { role, satisfies } = STATUS_INFO[s];
    if (role === "terminal") assert(satisfies, `${s} should satisfy`);
    if (role === "waiting" || role === "active") assert(!satisfies, `${s} should not satisfy`);
  }
});

Deno.test("kinds without a workflow use the default", () => {
  assertEquals(workflowOf("core.story"), DEFAULT_WORKFLOW);
  assertEquals(workflowOf("custom.thing"), DEFAULT_WORKFLOW);
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
