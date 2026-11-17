import { assert, assertEquals, assertRejects } from "@std/assert";
import { DomainError } from "../src/server/core/errors.ts";
import { fixture, git, initRepo } from "./helpers.ts";

/** A project with no repository, plus a bare seed repository holding one commit on main. */
async function setup() {
  const f = await fixture("Alpha", { v2: true });
  const root = f.dir.replace(/\/proj$/, "");
  await f.workspace.projects.file(f.projectId).mutate((hexes) => {
    delete hexes.find((h) => h.id === f.projectId)!.meta!.repo_path;
  });
  const src = `${root}/seed-src`;
  await initRepo(src);
  const bare = `${root}/seed.git`;
  await git(root, "clone", "-q", "--bare", src, bare);
  const seed = await f.service.createSeed({ title: "Starter", description: "", gitUrl: bare });
  return { ...f, root, bare, seedId: seed.hex.id };
}

const exists = (p: string) => Deno.stat(p).then(() => true, () => false);

Deno.test("createProject without a folder makes a project with no repository", async () => {
  const f = await fixture("Alpha", { v2: true });
  try {
    const { projectId } = await f.service.createProject({
      dir: "",
      title: "Later",
      description: "",
      gitInit: true,
    });
    const view = await f.service.projectView(projectId);
    assertEquals(view.project.meta?.repo_path, undefined);
    assertEquals(view.needsRepository, true);
  } finally {
    await f.cleanup();
  }
});

Deno.test("forking a seed clones it, renames origin to seed and records both paths", async () => {
  const f = await setup();
  try {
    const dir = `${f.root}/work`;
    const project = await f.service.setProjectRepo(f.projectId, { dir, seedId: f.seedId });
    assertEquals([project.meta?.repo_path, project.meta?.repo_ref_hx], [dir, f.seedId]);
    assertEquals(await git(dir, "remote"), "seed");
    assertEquals(await git(dir, "branch", "--show-current"), "main");
    assert(await exists(`${dir}/README.md`));
    assertEquals((await f.service.projectView(f.projectId)).needsRepository, false);

    // Switching to a plain folder drops the seed reference.
    const plain = `${f.root}/plain`;
    await initRepo(plain);
    const again = await f.service.setProjectRepo(f.projectId, { dir: plain });
    assertEquals([again.meta?.repo_path, again.meta?.repo_ref_hx], [plain, undefined]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("a fork refuses a non-empty folder or a retired seed, and a failed clone leaves nothing", async () => {
  const f = await setup();
  try {
    const s = f.service;
    const full = `${f.root}/full`;
    await Deno.mkdir(full);
    await Deno.writeTextFile(`${full}/x.txt`, "x");
    const notEmpty = await assertRejects(
      () => s.setProjectRepo(f.projectId, { dir: full, seedId: f.seedId }),
      DomainError,
      "not empty",
    );
    assertEquals(notEmpty.status, 409);

    await s.retireSeed(f.seedId);
    const retired = await assertRejects(
      () => s.setProjectRepo(f.projectId, { dir: `${f.root}/w2`, seedId: f.seedId }),
      DomainError,
      "retired",
    );
    assertEquals(retired.status, 409);

    const bad = await s.createSeed({
      title: "Gone",
      description: "",
      gitUrl: `${f.root}/nope.git`,
    });
    const target = `${f.root}/w3`;
    const failed = await assertRejects(
      () => s.setProjectRepo(f.projectId, { dir: target, seedId: bad.hex.id }),
      DomainError,
      "Could not fork",
    );
    assertEquals(failed.status, 422);
    assertEquals(await exists(target), false);
    assertEquals((await s.projectView(f.projectId)).needsRepository, true);
  } finally {
    await f.cleanup();
  }
});

Deno.test("a folder must be a git working tree and nobody else's repository", async () => {
  const f = await setup();
  try {
    const s = f.service;
    const loose = `${f.root}/loose`;
    await Deno.mkdir(loose);
    const notRepo = await assertRejects(
      () => s.setProjectRepo(f.projectId, { dir: loose }),
      DomainError,
      "not a git working tree",
    );
    assertEquals(notRepo.status, 422);

    const { projectId: other } = await s.createProject({
      dir: `${f.root}/taken`,
      title: "Beta",
      description: "",
      gitInit: true,
    });
    assert(other);
    const taken = await assertRejects(
      () => s.setProjectRepo(f.projectId, { dir: `${f.root}/taken` }),
      DomainError,
      "already the repo",
    );
    assertEquals(taken.status, 409);
  } finally {
    await f.cleanup();
  }
});

Deno.test("a v1 project must be migrated before it gets a repository this way", async () => {
  const f = await fixture();
  try {
    const err = await assertRejects(
      () => f.service.setProjectRepo(f.projectId, { dir: f.dir }),
      DomainError,
      "migrate it first",
    );
    assertEquals(err.status, 409);
  } finally {
    await f.cleanup();
  }
});
