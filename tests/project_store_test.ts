import { assertEquals } from "@std/assert";
import { hexesHome, HexFile, ProjectStore } from "../src/server/core/store.ts";
import { repoPathOf, schemaVersionOf } from "../src/shared/graph.ts";
import { SCHEMA_VERSION } from "../src/shared/constants.ts";
import type { Hex } from "../src/shared/schemas.ts";

function project(id: string, meta?: Record<string, string>): Hex {
  return {
    id,
    title: id,
    description: "",
    kind: "core.project",
    status: "done",
    createdAtTimeInMs: 1,
    lastUpdatedAtTimeInMs: 1,
    ...(meta ? { meta } : {}),
  };
}

Deno.test("hexesHome is HEXES_HOME, else ~/.hx", () => {
  const prev = Deno.env.get("HEXES_HOME");
  try {
    Deno.env.set("HEXES_HOME", "/tmp/somewhere/");
    assertEquals(hexesHome(), "/tmp/somewhere");
    Deno.env.delete("HEXES_HOME");
    assertEquals(hexesHome(), `${Deno.env.get("HOME")}/.hx`);
  } finally {
    if (prev === undefined) Deno.env.delete("HEXES_HOME");
    else Deno.env.set("HEXES_HOME", prev);
  }
});

Deno.test("ProjectStore paths sit under <home>/projects/<id>", () => {
  const store = new ProjectStore("/h/");
  assertEquals(store.projectDir("hx-a-001"), "/h/projects/hx-a-001");
  assertEquals(store.projectFile("hx-a-001"), "/h/projects/hx-a-001/data.json");
  assertEquals(store.file("hx-a-001").path, "/h/projects/hx-a-001/data.json");
});

Deno.test("ProjectStore writes, reads back and lists projects", async () => {
  const home = await Deno.makeTempDir();
  try {
    const store = new ProjectStore(home);
    assertEquals(await store.list(), []);
    await store.file("hx-b-002").mutate((h) => {
      h.push(project("hx-b-002"));
    }, { create: true });
    await store.file("hx-a-001").mutate((h) => {
      h.push(project("hx-a-001", { schema_version: SCHEMA_VERSION }));
    }, { create: true });
    await Deno.mkdir(`${home}/projects/empty`, { recursive: true });
    assertEquals(await store.list(), ["hx-a-001", "hx-b-002"]);
    const [a] = await store.file("hx-a-001").read();
    assertEquals(a?.id, "hx-a-001");
    assertEquals(schemaVersionOf(a), 2);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("v1 HexFile still reads <dir>/.hx/data.json", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = new HexFile(dir);
    assertEquals(file.path, `${dir}/.hx/data.json`);
    await file.mutate((h) => {
      h.push(project("hx-c-003"));
    }, { create: true });
    assertEquals((await file.read()).length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("schemaVersionOf defaults to 1; repoPathOf reads meta.repo_path", () => {
  assertEquals(schemaVersionOf(project("hx-a-001")), 1);
  assertEquals(schemaVersionOf(undefined), 1);
  assertEquals(schemaVersionOf(project("hx-a-001", { schema_version: "2" })), 2);
  assertEquals(repoPathOf(project("hx-a-001")), null);
  assertEquals(repoPathOf(project("hx-a-001", { repo_path: "/code/a" })), "/code/a");
});
