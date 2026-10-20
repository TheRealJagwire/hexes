import { assert } from "@std/assert";
import { createApp } from "../src/server/app.ts";
import { ChangeWatcher } from "../src/server/core/watcher.ts";
import { fixture } from "./helpers.ts";

/**
 * Golden API responses shared with the Android app: its parser tests read the same files, so a
 * change to the API shape fails here or there. Refresh them on purpose with
 * `UPDATE_CONTRACT=1 deno test -A tests/contract_test.ts`.
 */
const CONTRACT_DIR = new URL("../android/app/src/test/resources/contract/", import.meta.url);
const H = { host: "localhost:8000", "content-type": "application/json" };

Deno.test("api responses match the contract fixtures", async () => {
  const f = await fixture("Contract Demo");
  const app = createApp(f.service, new ChangeWatcher(f.workspace), {});
  const update = Deno.env.get("UPDATE_CONTRACT") === "1";
  try {
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(`/api${path}`, {
        method,
        headers: H,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, body: await res.json() };
    };
    const make = async (req: Record<string, unknown>) => {
      const res = await call("POST", "/hexes", { projectId: f.projectId, ...req });
      assert(res.status === 201, JSON.stringify(res.body));
      return res.body as { id: string };
    };

    const design = await make({
      kind: "core.design",
      title: "Board layout",
      dependsOn: [f.projectId],
      description: "Hexes on a **grid**.\n\n- axial coords\n- pointy tops",
    });
    const story = await make({
      kind: "core.story",
      title: "Draw the grid",
      dependsOn: [design.id],
      status: "blocked",
      meta: { git_branch: "feat/grid" },
    });
    const epic = await make({
      kind: "core.epic",
      title: "Board",
      dependsOn: [design.id, story.id],
    });
    await make({ kind: "core.question", title: "Wrap edges?", emergedFrom: design.id });
    await call("PATCH", `/hexes/${design.id}`, { status: "done" });
    const question = await make({ kind: "core.question", title: "Snap to grid?" });

    const checks: Record<string, { status: number; body: unknown }> = {
      state: await call("GET", "/state"),
      projects: await call("GET", "/projects"),
      project_view: await call("GET", `/projects/${f.projectId}`),
      hex_view: await call("GET", `/hexes/${story.id}`),
      hex_search: await call("GET", `/hexes?project=${f.projectId}&limit=50`),
      recent_workspaces: await call("GET", "/workspace/recent"),
      update_hex: await call("PATCH", `/hexes/${epic.id}`, { title: "Board (v1)" }),
      answer_question: await call("PATCH", `/hexes/${question.id}`, {
        status: "answered",
        response: "Yes, always.",
      }),
      statuses: await call("GET", "/statuses"),
      error_not_found: await call("GET", "/hexes/hx-nope-000"),
      error_stale_edit: await call("PATCH", `/hexes/${epic.id}`, {
        title: "x",
        expectedUpdatedAtTimeInMs: 1,
      }),
    };

    for (const [name, res] of Object.entries(checks)) {
      // The temp directory differs per run; the fixtures pretend it is a fixed path.
      const text = JSON.stringify({ status: res.status, body: res.body }, null, 2)
        .replaceAll(f.dir, "/home/user/demo")
        .replaceAll(f.dir.replace(/\/proj$/, ""), "/home/user");
      const file = new URL(`${name}.json`, CONTRACT_DIR);
      if (update) {
        await Deno.mkdir(CONTRACT_DIR, { recursive: true });
        await Deno.writeTextFile(file, text + "\n");
        continue;
      }
      let expected: string;
      try {
        expected = await Deno.readTextFile(file);
      } catch {
        throw new Error(`Missing contract fixture ${name}.json. Run with UPDATE_CONTRACT=1.`);
      }
      assert(
        expected === text + "\n",
        `API response "${name}" no longer matches ${name}.json. If the change is intended, ` +
          `run UPDATE_CONTRACT=1 deno test -A tests/contract_test.ts and update the app.`,
      );
    }
  } finally {
    await f.cleanup();
  }
});
