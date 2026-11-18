import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  allowBindingInGitignore,
  BINDING_UNIGNORE,
  findProjectBinding,
  readBinding,
  writeBinding,
} from "../src/server/core/binding.ts";
import { DomainError } from "../src/server/core/errors.ts";
import { fixture, initRepo } from "./helpers.ts";

Deno.test("findProjectBinding walks up to the nearest .hx/project.json", async () => {
  const root = await Deno.makeTempDir({ prefix: "hexes-binding-" });
  try {
    await writeBinding(`${root}/repo`, "hx-alpha-a1b");
    await Deno.mkdir(`${root}/repo/src/deep`, { recursive: true });
    assertEquals(await findProjectBinding(`${root}/repo/src/deep`), {
      projectId: "hx-alpha-a1b",
      dir: `${root}/repo`,
    });
    assertEquals(await findProjectBinding(`${root}/repo`), {
      projectId: "hx-alpha-a1b",
      dir: `${root}/repo`,
    });

    // A nested repository names its own project.
    await writeBinding(`${root}/repo/src/deep`, "hx-bravo-b2c");
    assertEquals((await findProjectBinding(`${root}/repo/src/deep`))?.projectId, "hx-bravo-b2c");

    // An unreadable or invalid file is no binding.
    await Deno.mkdir(`${root}/other/.hx`, { recursive: true });
    await Deno.writeTextFile(`${root}/other/.hx/project.json`, '{"project_id": "nope"}');
    assertEquals(await readBinding(`${root}/other`), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("binding a repo lets .hx/project.json past a .gitignore that hides .hx/", async () => {
  const root = await Deno.makeTempDir({ prefix: "hexes-binding-" });
  try {
    await Deno.writeTextFile(`${root}/.gitignore`, "node_modules/\n/.hx/\n.env\n");
    assert(await allowBindingInGitignore(root));
    assertEquals(
      await Deno.readTextFile(`${root}/.gitignore`),
      `node_modules/\n/.hx/*\n${BINDING_UNIGNORE}\n.env\n`,
    );
    // Already allowed: nothing changes.
    assert(!await allowBindingInGitignore(root));

    // A .gitignore that never mentions .hx is left alone.
    await Deno.writeTextFile(`${root}/.gitignore`, "dist/\n");
    assert(!await allowBindingInGitignore(root));
    assertEquals(await Deno.readTextFile(`${root}/.gitignore`), "dist/\n");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("git sees the binding but still ignores the rest of .hx", async () => {
  const root = await Deno.makeTempDir({ prefix: "hexes-binding-" });
  try {
    await initRepo(root);
    await Deno.writeTextFile(`${root}/.gitignore`, ".hx/\n");
    await writeBinding(root, "hx-alpha-a1b");
    await Deno.writeTextFile(`${root}/.hx/data.json`, "[]");
    const out = await new Deno.Command("git", {
      args: ["status", "--porcelain", "-uall", ".hx"],
      cwd: root,
      stdout: "piped",
    }).output();
    assertEquals(new TextDecoder().decode(out.stdout).trim(), "?? .hx/project.json");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("set_project_repo binds the folder, moves the binding and refuses another project's", async () => {
  const f = await fixture("Alpha", { v2: true });
  const root = f.dir.replace(/\/proj$/, "");
  try {
    assertEquals(await readBinding(f.dir), f.projectId, "createProject binds its folder");

    // Moving the project to another repo binds that one and frees the old one.
    const moved = `${root}/moved`;
    await initRepo(moved);
    await f.service.setProjectRepo(f.projectId, { dir: moved });
    assertEquals(await readBinding(moved), f.projectId);
    assertEquals(await readBinding(f.dir), null);

    // A folder bound to another project is refused, with that project named.
    const { projectId: other } = await f.service.createProject({
      dir: "",
      title: "Bravo",
      description: "",
      gitInit: false,
    });
    const theirs = `${root}/theirs`;
    await initRepo(theirs);
    await writeBinding(theirs, other);
    const err = await assertRejects(
      () => f.service.setProjectRepo(f.projectId, { dir: theirs }),
      DomainError,
      `already belongs to project ${other} (Bravo)`,
    );
    assertEquals(err.status, 409);
    assertEquals(await readBinding(theirs), other);
  } finally {
    await f.cleanup();
  }
});

Deno.test("the backfill binds existing repos and never overwrites a binding", async () => {
  const f = await fixture("Alpha", { v2: true });
  const root = f.dir.replace(/\/proj$/, "");
  try {
    // A project bound before bindings existed: repo_path set, no file.
    await Deno.remove(`${f.dir}/.hx`, { recursive: true });
    assertEquals(await f.service.backfillBindings(), [f.dir]);
    assertEquals(await readBinding(f.dir), f.projectId);
    assertEquals(await f.service.backfillBindings(), [], "nothing left to write");

    // A folder that already names a project keeps it.
    await writeBinding(f.dir, "hx-someone-else-abc");
    assertEquals(await f.service.backfillBindings(), []);
    assertEquals(await readBinding(f.dir), "hx-someone-else-abc");

    // find_project reports the nearest binding and its project.
    await writeBinding(f.dir, f.projectId);
    await Deno.mkdir(`${f.dir}/sub`, { recursive: true });
    const found = await f.service.findProject(`${f.dir}/sub`);
    assertEquals([found?.projectId, found?.dir, found?.project?.title], [
      f.projectId,
      f.dir,
      "Alpha",
    ]);
    assertEquals(await f.service.findProject(root), null);
  } finally {
    await f.cleanup();
  }
});
