import { assertEquals } from "@std/assert";
import { createApp } from "../src/server/app.ts";
import { fixture } from "./helpers.ts";

const H = { host: "localhost:8000" };
const J = { ...H, "content-type": "application/json" };

Deno.test("api guard refuses foreign hosts, origins and non-JSON writes", async () => {
  const f = await fixture();
  try {
    const app = createApp(f.service);
    assertEquals((await app.request("/api/health", { headers: H })).status, 200);
    assertEquals((await app.request("/api/health", { headers: { host: "evil.com" } })).status, 403);
    const body = JSON.stringify({ id: f.projectId });
    const cross = await app.request("/api/selected-project", {
      method: "POST",
      headers: { ...J, origin: "http://evil.com" },
      body,
    });
    assertEquals(cross.status, 403);
    const plain = await app.request("/api/selected-project", {
      method: "POST",
      headers: { ...H, "content-type": "text/plain" },
      body,
    });
    assertEquals(plain.status, 415);
  } finally {
    await f.cleanup();
  }
});

Deno.test("api: state, project, create, status, delete", async () => {
  const f = await fixture();
  try {
    const app = createApp(f.service);
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(`/api${path}`, {
        method,
        headers: J,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, json: await res.json() };
    };
    assertEquals((await call("GET", "/state")).json.selectedProjectId, f.projectId);
    const created = await call("POST", "/hexes", {
      projectId: f.projectId,
      kind: "core.story",
      title: "  Do it  ",
    });
    assertEquals([created.status, created.json.title, created.json.status], [
      201,
      "Do it",
      "blocked",
    ]);
    const id = created.json.id as string;
    assertEquals((await call("PATCH", `/hexes/${id}`, { status: "done" })).json.status, "done");
    assertEquals((await call("PUT", `/hexes/${id}/meta/branch`, { value: "main" })).json.meta, {
      branch: "main",
    });
    assertEquals((await call("GET", `/hexes?project=${f.projectId}&q=do`)).json.length, 1);
    assertEquals(
      (await call("POST", "/hexes", { projectId: f.projectId, kind: "bad", title: "x" })).status,
      400,
    );
    assertEquals((await call("GET", "/hexes/hx-nope-000")).status, 404);
    assertEquals((await call("DELETE", `/hexes/${id}`)).json.deleted, [id]);
    const page = await app.request("/p/anything", { headers: H });
    assertEquals(page.headers.get("content-type")?.includes("text/html"), true);
  } finally {
    await f.cleanup();
  }
});
