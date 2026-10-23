import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/build.ts";
import { createApp } from "../src/server/app.ts";
import { DomainError } from "../src/server/core/errors.ts";
import { branchName } from "../src/server/core/service.ts";
import { parseUnifiedDiff } from "../src/shared/diff.ts";
import { type Fixture, fixture, git, initRepo } from "./helpers.ts";

const base = { description: "", requiredBy: [], dependsOn: [], meta: {} };

/** A project in a git repository, with one ready story to work on. */
async function repoFixture(): Promise<Fixture & { storyId: string }> {
  const f = await fixture();
  await initRepo(f.dir);
  const story = await f.service.createHex({
    ...base,
    projectId: f.projectId,
    kind: "core.story",
    title: "Draw the Grid!",
    status: "ready",
  });
  return { ...f, storyId: story.id };
}

async function commitFile(dir: string, name: string, text: string) {
  await Deno.writeTextFile(`${dir}/${name}`, text);
  await git(dir, "add", name);
  await git(dir, "commit", "-q", "-m", `edit ${name}`);
}

Deno.test("branch names are hx/<id>-<slug>", () => {
  const hex = (title: string) => ({
    id: "hx-p-0a1",
    title,
    description: "",
    kind: "core.story",
    status: "ready" as const,
    createdAtTimeInMs: 0,
    lastUpdatedAtTimeInMs: 0,
  });
  assertEquals(branchName(hex("Draw the Grid!")), "hx/hx-p-0a1-draw-the-grid");
  assertEquals(branchName(hex("???")), "hx/hx-p-0a1");
  assertEquals(branchName(hex("a".repeat(60))), `hx/hx-p-0a1-${"a".repeat(40)}`);
});

Deno.test("start work: a branch off main, recorded on the hex, safe to repeat", async () => {
  const f = await repoFixture();
  try {
    const s = f.service;
    const design = await s.createHex({
      ...base,
      projectId: f.projectId,
      kind: "core.design",
      title: "D",
      status: "blocked",
    });
    await assertRejects(() => s.startWork(design.id), DomainError, "not worked on a branch");

    await Deno.writeTextFile(`${f.dir}/README.md`, "dirty\n");
    await assertRejects(() => s.startWork(f.storyId), DomainError, "Commit or stash");
    await git(f.dir, "checkout", "--", "README.md");

    const mainSha = await git(f.dir, "rev-parse", "main");
    const started = await s.startWork(f.storyId);
    const branch = `hx/${f.storyId}-draw-the-grid`;
    assertEquals(started.status, "in_progress");
    assertEquals(started.meta, { git_branch: branch, base_sha: mainSha });
    assertEquals(await git(f.dir, "branch", "--show-current"), branch);

    await git(f.dir, "switch", "-q", "main");
    const again = await s.startWork(f.storyId);
    assertEquals(again.meta, started.meta);
    assertEquals(await git(f.dir, "branch", "--show-current"), branch);
  } finally {
    await f.cleanup();
  }
});

Deno.test("open, merge and finish: the work goes in_review, then merged", async () => {
  const f = await repoFixture();
  try {
    const s = f.service;
    await assertRejects(() => s.openPullRequest(f.storyId), DomainError, "Start work");
    await s.startWork(f.storyId);
    await assertRejects(() => s.openPullRequest(f.storyId), DomainError, "no commits");

    await commitFile(f.dir, "grid.ts", "export const size = 3;\n");
    const pr = await s.openPullRequest(f.storyId);
    assertEquals([pr.kind, pr.status, pr.title], [
      "core.pull_request",
      "pull_requested",
      "PR: Draw the Grid!",
    ]);
    assertEquals(pr.meta?.work_hex, f.storyId);
    assertEquals((await s.getHex(f.storyId)).status, "in_review");
    assertEquals(pr.meta?.target_branch, "main");
    assertEquals(pr.meta?.base_sha, await git(f.dir, "rev-parse", "main"));
    await assertRejects(() => s.openPullRequest(f.storyId), DomainError, "already has an open");
    await assertRejects(
      () => s.updateHex(pr.id, { status: "merged" }),
      DomainError,
      "merged or closed",
    );

    const view = await s.hexView(f.storyId);
    assertEquals(view.workBranch, pr.meta?.source_branch);
    assertEquals(view.pullRequests.map((p) => [p.id, p.status, p.mergeSha]), [
      [pr.id, "pull_requested", null],
    ]);
    assertEquals(view.dependsOn.map((d) => d.id), [pr.id]);
    assertEquals((await s.hexView(pr.id)).workHex?.id, f.storyId);
    await assertRejects(
      () => s.updateHex(f.storyId, { status: "done" }),
      DomainError,
      "finishes by merging its pull request",
    );

    const open = await s.pullRequestDiff(pr.id);
    assertEquals(open.source, "git");
    assertEquals(open.files.map((x) => [x.path, x.status, x.additions]), [["grid.ts", "added", 1]]);

    const merged = await s.mergePullRequest(pr.id);
    assertEquals(merged.status, "merged");
    assertEquals((await s.getHex(f.storyId)).status, "merged");
    assertEquals(await git(f.dir, "branch", "--show-current"), "main");
    assertEquals(merged.meta?.merge_sha, await git(f.dir, "rev-parse", "main"));
    assertEquals(
      await git(f.dir, "log", "-1", "--format=%s"),
      `Merge ${pr.meta?.source_branch}: Draw the Grid! (${f.storyId})`,
    );
    assert((await Deno.readTextFile(`${f.dir}/.hx/diffs/${pr.id}.patch`)).includes("grid.ts"));
    await assertRejects(() => s.mergePullRequest(pr.id), DomainError, "already merged");

    const diff = await s.pullRequestDiff(pr.id);
    assertEquals(diff.files[0]?.hunks[0]?.lines, [
      { kind: "add", oldNo: null, newNo: 1, text: "export const size = 3;" },
    ]);
    assertEquals((await s.hexView(f.storyId)).pullRequests[0]?.mergeSha, merged.meta?.merge_sha);

    // Once the commits are gone, the patch saved at merge time stands in.
    await s.setMeta(pr.id, "merge_sha", "0".repeat(40));
    const saved = await s.pullRequestDiff(pr.id);
    assertEquals(saved.source, "snapshot");
    assertEquals(saved.files, diff.files);
  } finally {
    await f.cleanup();
  }
});

Deno.test("a conflicting merge changes nothing and says which files conflict", async () => {
  const f = await repoFixture();
  try {
    const s = f.service;
    const { meta } = await s.startWork(f.storyId);
    await commitFile(f.dir, "README.md", "from the branch\n");
    const pr = await s.openPullRequest(f.storyId);
    await git(f.dir, "switch", "-q", "main");
    await commitFile(f.dir, "README.md", "from main\n");
    await git(f.dir, "switch", "-q", meta!.git_branch!);
    const mainBefore = await git(f.dir, "rev-parse", "main");

    const err = await assertRejects(() => s.mergePullRequest(pr.id), DomainError, "README.md");
    assertEquals(err.status, 409);
    assertEquals((await s.getHex(pr.id)).status, "pull_requested");
    assertEquals(await git(f.dir, "rev-parse", "main"), mainBefore);
    assertEquals(await git(f.dir, "branch", "--show-current"), meta!.git_branch);
    assertEquals(await git(f.dir, "status", "--porcelain", "--untracked-files=no"), "");
  } finally {
    await f.cleanup();
  }
});

Deno.test("closing a pull request keeps it and lets the work go on without it", async () => {
  const f = await repoFixture();
  try {
    const s = f.service;
    await s.startWork(f.storyId);
    await commitFile(f.dir, "a.txt", "a\n");
    const pr = await s.openPullRequest(f.storyId);
    const closed = await s.closePullRequest(pr.id);
    assertEquals(closed.status, "closed");
    assertEquals((await s.getHex(f.storyId)).status, "in_progress");
    assert(closed.meta?.closed_at);
    assertEquals((await s.getHex(f.storyId)).dependsOn, undefined);
    await assertRejects(() => s.mergePullRequest(pr.id), DomainError, "already closed");
    await assertRejects(
      () => s.updateHex(f.storyId, { status: "done" }),
      DomainError,
      "finishes by merging its pull request",
    );
    // A new pull request can be opened for the same branch once the old one is closed.
    const again = await s.openPullRequest(f.storyId, { title: "Second try" });
    assertEquals((await s.hexView(f.storyId)).pullRequests.map((p) => p.id), [again.id, pr.id]);
    assertEquals((await s.getHex(f.storyId)).status, "in_review");
  } finally {
    await f.cleanup();
  }
});

Deno.test("branch operations need a repository that ignores .hx/", async () => {
  const f = await fixture();
  try {
    const story = await f.service.createHex({
      ...base,
      projectId: f.projectId,
      kind: "core.story",
      title: "S",
      status: "ready",
    });
    const err = await assertRejects(() => f.service.startWork(story.id), DomainError);
    assertEquals(err.status, 501);
    await initRepo(f.dir);
    await Deno.writeTextFile(`${f.dir}/.gitignore`, "");
    await git(f.dir, "commit", "-q", "-am", "stop ignoring");
    await assertRejects(() => f.service.startWork(story.id), DomainError, ".gitignore");
  } finally {
    await f.cleanup();
  }
});

Deno.test("the diff parser handles renames, deletions and binary files", async () => {
  const dir = await Deno.makeTempDir({ prefix: "hexes-diff-" });
  try {
    await initRepo(dir);
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") + "\n";
    await commitFile(dir, "old.txt", lines);
    await commitFile(dir, "gone.txt", "bye\n");
    const before = await git(dir, "rev-parse", "HEAD");
    await git(dir, "mv", "old.txt", "new.txt");
    await Deno.writeTextFile(`${dir}/new.txt`, lines.replace("line 3\n", "line three\n"));
    await git(dir, "rm", "-q", "gone.txt");
    await Deno.writeFile(`${dir}/pic.bin`, new Uint8Array([0, 1, 2, 0, 255]));
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "change");
    const text = await git(dir, "diff", "--no-color", "-M", before, "HEAD");

    const files = parseUnifiedDiff(text);
    const byPath = Object.fromEntries(files.map((x) => [x.path, x]));
    assertEquals(byPath["new.txt"]?.status, "renamed");
    assertEquals(byPath["new.txt"]?.oldPath, "old.txt");
    assertEquals([byPath["new.txt"]?.additions, byPath["new.txt"]?.deletions], [1, 1]);
    const changed = byPath["new.txt"]!.hunks[0]!.lines.filter((l) => l.kind !== "context");
    assertEquals(changed, [
      { kind: "del", oldNo: 4, newNo: null, text: "line 3" },
      { kind: "add", oldNo: null, newNo: 4, text: "line three" },
    ]);
    assertEquals(byPath["gone.txt"]?.status, "deleted");
    assertEquals(byPath["pic.bin"]?.binary, true);
    assertEquals(byPath["pic.bin"]?.status, "added");
    assertEquals(parseUnifiedDiff(""), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("merging refuses uncommitted changes, and a huge diff lists files only", async () => {
  const f = await repoFixture();
  try {
    const s = f.service;
    await s.startWork(f.storyId);
    await commitFile(f.dir, "big.txt", ("x".repeat(99) + "\n").repeat(11_000));
    const pr = await s.openPullRequest(f.storyId);

    const diff = await s.pullRequestDiff(pr.id);
    assertEquals(diff.truncated, true);
    assertEquals(diff.files.map((x) => [x.path, x.additions, x.hunks.length]), [
      ["big.txt", 11_000, 0],
    ]);

    await Deno.writeTextFile(`${f.dir}/README.md`, "uncommitted\n");
    await assertRejects(() => s.mergePullRequest(pr.id), DomainError, "README.md");
    assertEquals((await s.getHex(pr.id)).status, "pull_requested");
  } finally {
    await f.cleanup();
  }
});

Deno.test("the pull-request flow over REST", async () => {
  const f = await repoFixture();
  try {
    const app = createApp(f.service);
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(`/api${path}`, {
        method,
        headers: { host: "localhost:8000", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, json: await res.json() };
    };
    const id = f.storyId;
    assertEquals((await call("POST", `/hexes/${id}/pull-requests`, {})).status, 409);
    const started = await call("POST", `/hexes/${id}/branch`);
    assertEquals([started.status, started.json.status], [200, "in_progress"]);
    await commitFile(f.dir, "a.txt", "a\n");
    const pr = await call("POST", `/hexes/${id}/pull-requests`, { title: "Grid" });
    assertEquals([pr.status, pr.json.title, pr.json.status], [201, "Grid", "pull_requested"]);
    const view = await call("GET", `/hexes/${id}`);
    assertEquals(view.json.pullRequests[0].id, pr.json.id);
    const diff = await call("GET", `/hexes/${pr.json.id}/diff`);
    assertEquals(diff.json.files[0].path, "a.txt");
    assertEquals((await call("GET", `/hexes/${id}/diff`)).status, 422);
    const merged = await call("POST", `/hexes/${pr.json.id}/merge`);
    assertEquals([merged.status, merged.json.status], [200, "merged"]);
    const closed = await call("POST", `/hexes/${pr.json.id}/close`);
    assertEquals([closed.status, closed.json.error], [409, `${pr.json.id} is already merged`]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("the pull-request flow over MCP", async () => {
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
    const id = f.storyId;
    assertEquals((await call("start_work_branch", { id })).status, "in_progress");
    await commitFile(f.dir, "a.txt", "a\nb\n");
    const pr = await call("open_pull_request", { id });
    const diff = await call("get_pull_request_diff", { id: pr.id });
    assertEquals(diff.files, [{
      path: "a.txt",
      oldPath: null,
      status: "added",
      additions: 2,
      deletions: 0,
      binary: false,
    }]);
    assertEquals(diff.patch, "--- a.txt\n+++ a.txt\n@@ -0,0 +1,2 @@\n+a\n+b");
    assertEquals((await call("merge_pull_request", { id: pr.id })).status, "merged");
    assertEquals((await call("get_hex_by_id", { id })).status, "merged");
    assert((await call("close_pull_request", { id: pr.id })).error.includes("already merged"));
  } finally {
    await client.close();
    await f.cleanup();
  }
});

Deno.test("merging unblocks what waits on the work, with no status change by hand", async () => {
  const f = await repoFixture();
  try {
    const s = f.service;
    const next = await s.createHex({
      ...base,
      projectId: f.projectId,
      kind: "core.story",
      title: "Next",
      status: "blocked",
      dependsOn: [f.storyId],
    });
    await s.startWork(f.storyId);
    await commitFile(f.dir, "a.txt", "a\n");
    const pr = await s.openPullRequest(f.storyId);
    assertEquals((await s.getHex(next.id)).status, "blocked");
    await s.mergePullRequest(pr.id);
    assertEquals((await s.getHex(f.storyId)).status, "merged");
    assertEquals((await s.getHex(next.id)).status, "ready");
  } finally {
    await f.cleanup();
  }
});

Deno.test("in_review and merged follow pull requests only", async () => {
  const f = await repoFixture();
  try {
    const s = f.service;
    await assertRejects(
      () => s.updateHex(f.storyId, { status: "in_review" }),
      DomainError,
      "in_review is set by opening a pull request",
    );
    await assertRejects(
      () =>
        s.createHex({
          ...base,
          projectId: f.projectId,
          kind: "core.bug",
          title: "B",
          status: "merged",
        }),
      DomainError,
      "merged is set by merging",
    );

    // Closing one of two open pull requests leaves the work in review.
    const { meta } = await s.startWork(f.storyId);
    await commitFile(f.dir, "a.txt", "a\n");
    const first = await s.openPullRequest(f.storyId);
    await git(f.dir, "switch", "-q", "-c", "other", meta!.git_branch!);
    await s.setMeta(f.storyId, "git_branch", "other");
    await commitFile(f.dir, "b.txt", "b\n");
    const second = await s.openPullRequest(f.storyId);
    await s.closePullRequest(first.id);
    assertEquals((await s.getHex(f.storyId)).status, "in_review");

    // Merged work is finished: it takes no new pull request until someone reopens it.
    await git(f.dir, "switch", "-q", "main");
    await s.mergePullRequest(second.id);
    await assertRejects(() => s.openPullRequest(f.storyId), DomainError, "already merged");
    assertEquals((await s.updateHex(f.storyId, { status: "in_progress" })).status, "in_progress");
  } finally {
    await f.cleanup();
  }
});
