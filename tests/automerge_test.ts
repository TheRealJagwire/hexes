import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/build.ts";
import { createApp } from "../src/server/app.ts";
import { type Fixture, fixture, git, initRepo } from "./helpers.ts";

const base = { description: "", requiredBy: [], dependsOn: [], meta: {} };

/** A project in a git repository, with auto-merge left at its default (on). */
async function repoFixture(): Promise<Fixture> {
  const f = await fixture();
  await initRepo(f.dir);
  return f;
}

async function story(f: Fixture, title: string): Promise<string> {
  const h = await f.service.createHex({
    ...base,
    projectId: f.projectId,
    kind: "core.story",
    title,
    status: "ready",
  });
  return h.id;
}

/** Starts work on a new story and commits `files` on its branch, leaving it checked out. */
async function workOn(f: Fixture, title: string, files: Record<string, string>) {
  const id = await story(f, title);
  const started = await f.service.startWork(id);
  for (const [name, text] of Object.entries(files)) {
    await Deno.writeTextFile(`${f.dir}/${name}`, text);
    await git(f.dir, "add", name);
  }
  await git(f.dir, "commit", "-q", "-m", title);
  return { id, branch: started.meta!.git_branch! };
}

Deno.test("auto-merge is on by default and a person can turn it off and on", async () => {
  const f = await fixture();
  try {
    const s = f.service;
    assertEquals((await s.projectView(f.projectId)).autoMerge, true);
    const off = await s.setAutoMerge(f.projectId, false);
    assertEquals(off.meta?.auto_merge, "off");
    assertEquals((await s.projectView(f.projectId)).autoMerge, false);
    await s.setAutoMerge(f.projectId, true);
    assertEquals((await s.projectView(f.projectId)).autoMerge, true);

    const app = createApp(s);
    const put = (id: string, body: unknown) =>
      app.request(`/api/projects/${id}/auto-merge`, {
        method: "PUT",
        headers: { host: "localhost:8000", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const res = await put(f.projectId, { enabled: false });
    assertEquals([res.status, (await res.json()).meta.auto_merge], [200, "off"]);
    assertEquals((await put(f.projectId, { enabled: "yes" })).status, 400);
    const storyId = await story(f, "Not a project");
    assertEquals((await put(storyId, { enabled: true })).status, 404);
  } finally {
    await f.cleanup();
  }
});

Deno.test("opening a pull request with auto-merge on merges it and updates the other branches", async () => {
  const f = await repoFixture();
  try {
    const s = f.service;
    const a = await workOn(f, "A", { "a.txt": "a\n", "README.md": "from A\n" });
    const b = await workOn(f, "B", { "b.txt": "b\n" });
    const c = await workOn(f, "C", { "README.md": "from C\n" });
    const d = await workOn(f, "D", { "d.txt": "d\n" });
    const e = await workOn(f, "E", { "e.txt": "e\n" });
    // B and C were opened while auto-merge was off, so they are still open.
    await s.setAutoMerge(f.projectId, false);
    const prB = await s.openPullRequest(b.id);
    const prC = await s.openPullRequest(c.id);
    assertEquals([prB.status, prC.status], ["pull_requested", "pull_requested"]);
    await s.setAutoMerge(f.projectId, true);
    // E is checked out with uncommitted changes: it must be left alone.
    await Deno.writeTextFile(`${f.dir}/e.txt`, "uncommitted\n");
    const eHead = await git(f.dir, "rev-parse", e.branch);
    const cHead = await git(f.dir, "rev-parse", c.branch);

    const pr = await s.openPullRequest(a.id);
    assertEquals(pr.status, "merged");
    assertEquals((await s.getHex(a.id)).status, "merged");
    assertEquals(await git(f.dir, "show", "main:a.txt"), "a");
    assertEquals(await git(f.dir, "branch", "--show-current"), e.branch);
    assertEquals(await Deno.readTextFile(`${f.dir}/e.txt`), "uncommitted\n");

    // B (open PR) and D (work without a PR) now have main merged in.
    for (const branch of [b.branch, d.branch]) {
      assertEquals(await git(f.dir, "show", `${branch}:a.txt`), "a");
      assertEquals(
        await git(f.dir, "log", "-1", "--format=%s", branch),
        `Merge main into ${branch}`,
      );
    }
    const updatedB = await s.getHex(prB.id);
    assertEquals(updatedB.meta?.head_sha, await git(f.dir, "rev-parse", b.branch));
    assertEquals(updatedB.meta?.merge_conflicts, undefined);
    // C conflicts: nothing changes in git, and the conflict is recorded on its PR.
    assertEquals(await git(f.dir, "rev-parse", c.branch), cHead);
    assertEquals((await s.getHex(prC.id)).meta?.merge_conflicts, "README.md");
    assertEquals(await git(f.dir, "rev-parse", e.branch), eHead);

    const note = pr.meta?.auto_merge_result ?? "";
    assert(note.startsWith("merged; "), note);
    assertStringIncludes(note, `updated ${[b.branch, d.branch].sort().join(", ")}`);
    assertStringIncludes(note, `conflicts in ${c.branch} (README.md)`);
    assertStringIncludes(note, `skipped ${e.branch} (uncommitted changes)`);
    // Turning it on did not merge the pull requests that were already open.
    assertEquals((await s.getHex(prB.id)).status, "pull_requested");
  } finally {
    await f.cleanup();
  }
});

Deno.test("a conflicting auto-merge leaves the pull request open, and off leaves it alone", async () => {
  const f = await repoFixture();
  try {
    const s = f.service;
    const a = await workOn(f, "A", { "README.md": "from A\n" });
    await git(f.dir, "switch", "-q", "main");
    await Deno.writeTextFile(`${f.dir}/README.md`, "from main\n");
    await git(f.dir, "commit", "-q", "-am", "main edit");
    const mainHead = await git(f.dir, "rev-parse", "main");

    const pr = await s.openPullRequest(a.id);
    assertEquals(pr.status, "pull_requested");
    assertEquals(pr.meta?.merge_conflicts, "README.md");
    assert(pr.meta?.auto_merge_result?.startsWith("not merged: "), pr.meta?.auto_merge_result);
    assertEquals((await s.getHex(a.id)).status, "in_review");
    assertEquals(await git(f.dir, "rev-parse", "main"), mainHead);

    await s.setAutoMerge(f.projectId, false);
    const b = await workOn(f, "B", { "b.txt": "b\n" });
    const manual = await s.openPullRequest(b.id);
    assertEquals(manual.status, "pull_requested");
    assertEquals(manual.meta?.auto_merge_result, undefined);
    assertEquals(await git(f.dir, "rev-parse", "main"), mainHead);
  } finally {
    await f.cleanup();
  }
});

Deno.test("over MCP: agents see auto-merge and its merges, but cannot change it", async () => {
  const f = await repoFixture();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await buildServer(f.service).connect(serverT);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientT);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { text: string }[])[0]?.text ?? "";
    return res.isError ? { error: text } : JSON.parse(text);
  };
  try {
    assertEquals((await call("get_project", { project_id: f.projectId })).autoMerge, true);
    const a = await workOn(f, "A", { "a.txt": "a\n" });
    const pr = await call("open_pull_request", { id: a.id });
    assertEquals(pr.status, "merged");
    assertEquals((await call("get_hex_by_id", { id: a.id })).status, "merged");

    const id = f.projectId;
    for (
      const [tool, args] of [
        ["add_meta_state_to_hex_with_id", { id, key: "auto_merge", value: "off" }],
        ["update_meta_state_to_hex_with_id", { id, key: "auto_merge", value: "off" }],
        ["remove_meta_state_from_hex_with_id", { id, key: "auto_merge" }],
      ] as const
    ) {
      assertStringIncludes((await call(tool, args)).error, "Only a person turns auto-merge");
    }
    assertEquals((await f.service.projectView(id)).autoMerge, true);
    // Other meta on a project is still the agent's to change.
    assertEquals(
      (await call("add_meta_state_to_hex_with_id", { id, key: "x", value: "1" })).meta.x,
      "1",
    );
  } finally {
    await client.close();
    await f.cleanup();
  }
});
