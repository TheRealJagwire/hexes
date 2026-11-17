import { assert, assertEquals } from "@std/assert";
import { ProjectStore } from "../src/server/core/store.ts";
import {
  allowedStatuses,
  roleOf,
  satisfies,
  SEED_DESCRIPTION_LIMIT,
  SEED_KIND,
  workflowOf,
} from "../src/shared/constants.ts";
import { isWorkKind, seedWarnings } from "../src/shared/graph.ts";

Deno.test("a seed is available or retired, never blocked, and is not work", () => {
  assertEquals(allowedStatuses(SEED_KIND), ["available", "retired"]);
  assertEquals(workflowOf(SEED_KIND).promoteTo, null);
  assert(!allowedStatuses(SEED_KIND).includes("ready"));
  assertEquals([roleOf("available"), satisfies("available")], ["actionable", true]);
  assertEquals([roleOf("retired"), satisfies("retired")], ["terminal", false]);
  assertEquals(isWorkKind(SEED_KIND), false);
});

Deno.test("seeds live in <home>/seeds/data.json, apart from every project", async () => {
  const home = await Deno.makeTempDir({ prefix: "hexes-seeds-" });
  try {
    const store = new ProjectStore(home);
    assertEquals(store.seedsFile, `${home}/seeds/data.json`);
    assertEquals(store.seeds().path, store.seedsFile);
    await store.seeds().mutate((hexes) => {
      hexes.push({
        id: "hx-seed-0a1",
        title: "Deno app",
        description: "Deno + Hono.",
        kind: SEED_KIND,
        status: "available",
        createdAtTimeInMs: 1,
        lastUpdatedAtTimeInMs: 1,
        meta: { git_url: "https://example.com/deno-app.git" },
      });
    }, { create: true });
    assertEquals((await store.seeds().read()).map((h) => h.id), ["hx-seed-0a1"]);
    assertEquals(await store.list(), [], "seeds are not a project");
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("seedWarnings flags a long description and a missing git URL", () => {
  const ok = { description: "Short.", meta: { git_url: "/srv/seed.git" } };
  assertEquals(seedWarnings(ok), []);
  assertEquals(seedWarnings({ ...ok, description: "x".repeat(SEED_DESCRIPTION_LIMIT) }), []);
  assertEquals(seedWarnings({ ...ok, description: "x".repeat(SEED_DESCRIPTION_LIMIT + 1) }), [
    `description is over ${SEED_DESCRIPTION_LIMIT} characters`,
  ]);
  assertEquals(seedWarnings({ description: "Short." }), ["meta.git_url is missing"]);
});
