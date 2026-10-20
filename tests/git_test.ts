import { assertEquals, assertRejects } from "@std/assert";
import { DomainError } from "../src/server/core/errors.ts";
import { Git } from "../src/server/core/git.ts";
import { git, initRepo } from "./helpers.ts";

async function withRepo(fn: (dir: string, g: Git) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "hexes-git-" });
  try {
    await initRepo(dir);
    await fn(dir, new Git(dir));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("git: repository, ignore and clean-tree checks", async () => {
  await withRepo(async (dir, g) => {
    await g.assertRepo();
    await g.assertDataIgnored();
    await g.assertClean();

    await Deno.writeTextFile(`${dir}/untracked.txt`, "x");
    await g.assertClean(); // untracked files do not count
    await Deno.writeTextFile(`${dir}/README.md`, "changed\n");
    assertEquals(await g.dirtyFiles(), ["README.md"]);
    await assertRejects(() => g.assertClean(), DomainError, "README.md");

    await Deno.writeTextFile(`${dir}/.gitignore`, "");
    await assertRejects(() => g.assertDataIgnored(), DomainError, ".gitignore");
  });
  const plain = await Deno.makeTempDir({ prefix: "hexes-norepo-" });
  try {
    const err = await assertRejects(() => new Git(plain).assertRepo(), DomainError);
    assertEquals(err.status, 501);
  } finally {
    await Deno.remove(plain, { recursive: true });
  }
});

Deno.test("git: branches, commits and how far ahead a branch is", async () => {
  await withRepo(async (dir, g) => {
    assertEquals(await g.mainBranch(), "main");
    assertEquals(await g.currentBranch(), "main");
    const base = await g.revParse("main");
    assertEquals(await g.hasCommit(base), true);
    assertEquals(await g.hasCommit("0".repeat(40)), false);

    await git(dir, "switch", "-q", "-c", "feature");
    assertEquals(await g.branchExists("feature"), true);
    assertEquals(await g.branchExists("nope"), false);
    assertEquals(await g.aheadOf("main", "feature"), 0);
    await Deno.writeTextFile(`${dir}/a.txt`, "a\n");
    await git(dir, "add", "a.txt");
    await git(dir, "commit", "-q", "-m", "a");
    assertEquals(await g.aheadOf("main", "feature"), 1);
    assertEquals(await g.mergeBase("main", "feature"), base);

    await git(dir, "branch", "-q", "-m", "main", "master");
    assertEquals(await g.mainBranch(), "master");
    await assertRejects(() => g.run("rev-parse", "--verify", "nope"), DomainError, "git rev-parse");
  });
});

Deno.test("git: serial runs one task at a time per directory", async () => {
  const g = new Git("/tmp/hexes-serial-test");
  const order: string[] = [];
  const slow = g.serial(async () => {
    await new Promise((r) => setTimeout(r, 20));
    order.push("first");
  });
  const fast = g.serial(() => {
    order.push("second");
    return Promise.resolve();
  });
  const failed = g.serial(() => Promise.reject(new Error("boom")));
  const after = g.serial(() => {
    order.push("after a failure");
    return Promise.resolve();
  });
  await Promise.all([slow, fast, failed.catch(() => {}), after]);
  assertEquals(order, ["first", "second", "after a failure"]);
});
