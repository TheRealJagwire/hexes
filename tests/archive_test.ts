import { assert, assertEquals } from "@std/assert";
import { createApp } from "../src/server/app.ts";
import { fixture } from "./helpers.ts";

const base = { description: "", requiredBy: [], meta: {} };

Deno.test("an epic is archived once all its stories are closed, and can be unarchived", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    const make = (kind: string, title: string, status: "ready" | "blocked", dependsOn: string[]) =>
      s.createHex({ ...base, projectId: f.projectId, kind, title, status, dependsOn });
    const a = await make("core.story", "A", "ready", [f.projectId]);
    const b = await make("core.story", "B", "ready", [f.projectId]);
    const epic = await make("core.epic", "E", "blocked", [a.id, b.id]);
    const empty = await make("core.epic", "Empty", "blocked", [f.projectId]);

    const app = createApp(s);
    const put = (id: string, body: unknown) =>
      app.request(`/api/hexes/${id}/archived`, {
        method: "PUT",
        headers: { host: "localhost:8000", "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    // An open story, no stories at all, or not an epic: refused.
    await s.updateHex(a.id, { status: "done" });
    assertEquals((await put(epic.id, { archived: true })).status, 409);
    assertEquals((await put(empty.id, { archived: true })).status, 409);
    assertEquals((await put(a.id, { archived: true })).status, 400);
    assertEquals((await put("hx-nope-000", { archived: true })).status, 404);
    assertEquals((await put(epic.id, { archived: "yes" })).status, 400);
    assertEquals((await s.getHex(epic.id)).meta?.archived, undefined);

    await s.updateHex(b.id, { status: "done" });
    const res = await put(epic.id, { archived: true });
    assertEquals(res.status, 200);
    const archived = (await res.json()).meta.archived as string;
    assert(!Number.isNaN(Date.parse(archived)), archived);
    const view = await s.projectView(f.projectId);
    assertEquals(view.epics.find((e) => e.hex.id === epic.id)?.hex.meta?.archived, archived);

    const back = await put(epic.id, { archived: false });
    assertEquals([back.status, (await back.json()).meta.archived], [200, undefined]);
  } finally {
    await f.cleanup();
  }
});
