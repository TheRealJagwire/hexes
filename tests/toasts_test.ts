import { assertEquals } from "@std/assert";
import { FakeTime } from "jsr:@std/testing@^1/time";
import { MIGRATION_TEXT, MigrationOffer } from "../src/client/lib/migration.ts";
import { MAX_TOASTS, ToastStore } from "../src/client/lib/toasts.ts";
import type { WorkspaceState } from "../src/shared/views.ts";

const texts = (s: ToastStore) => s.items.value.map((t) => t.text);

Deno.test("toasts go after 4 s, failures after 8 s", () => {
  using time = new FakeTime();
  const s = new ToastStore();
  s.show("Blessed hx-a");
  s.show("Nope", "failure");
  time.tick(3999);
  assertEquals(texts(s), ["Blessed hx-a", "Nope"]);
  time.tick(1);
  assertEquals(texts(s), ["Nope"]);
  time.tick(4000);
  assertEquals(texts(s), []);
});

Deno.test("hovering pauses a toast, and leaving restarts its full timer", () => {
  using time = new FakeTime();
  const s = new ToastStore();
  s.show("Saved");
  const id = s.items.value[0]!.id;
  time.tick(3000);
  s.pause(id);
  time.tick(60_000);
  assertEquals(texts(s), ["Saved"]);
  s.resume(id);
  time.tick(3999);
  assertEquals(texts(s), ["Saved"]);
  time.tick(1);
  assertEquals(texts(s), []);
});

Deno.test("at most three show, the oldest leaving first, and close removes one", () => {
  using _time = new FakeTime();
  const s = new ToastStore();
  for (const n of [1, 2, 3, 4]) s.show(`t${n}`);
  assertEquals(texts(s), ["t2", "t3", "t4"]);
  assertEquals(s.items.value.length, MAX_TOASTS);
  s.close(s.items.value[1]!.id);
  assertEquals(texts(s), ["t2", "t4"]);
});

Deno.test("a toast updates in place and a null ttl keeps it until updated", () => {
  using time = new FakeTime();
  const s = new ToastStore();
  const h = s.show("Telling Claude…", "info", null);
  time.tick(120_000);
  assertEquals(texts(s), ["Telling Claude…"]);
  h.update({ text: "Claude picked it up", kind: "success", ttl: 4000 });
  assertEquals(s.items.value.map((t) => [t.text, t.kind]), [["Claude picked it up", "success"]]);
  time.tick(4000);
  assertEquals(texts(s), []);
  h.update({ text: "gone" }); // closed already: nothing comes back
  assertEquals(texts(s), []);
});

Deno.test("a toast's actions are kept, and onClose runs however it goes", () => {
  using time = new FakeTime();
  const s = new ToastStore();
  const closed: string[] = [];
  s.show("a", "info", null, {
    actions: [{ label: "Go", run: () => {} }],
    onClose: () => closed.push("a"),
  });
  s.show("b", "success", 1000, { onClose: () => closed.push("b") });
  assertEquals(s.items.value[0]?.actions?.map((x) => x.label), ["Go"]);
  time.tick(1000);
  assertEquals(closed, ["b"]);
  s.close(s.items.value[0]!.id);
  assertEquals(closed, ["b", "a"]);
});

const state = (over: Partial<WorkspaceState>): WorkspaceState => ({
  dir: "/code/a",
  pinned: false,
  lastDir: "/code/a",
  selectedProjectId: "hx-a-001",
  schemaVersion: 1,
  repoPath: "/code/a",
  ...over,
});

Deno.test("the migration offer shows for a v1 folder, never for v2 or a pinned one", () => {
  using _time = new FakeTime();
  const s = new ToastStore();
  const offer = new MigrationOffer(s, () => Promise.resolve({ projects: [] }), () => {});
  offer.update(state({ schemaVersion: 2 }));
  offer.update(state({ pinned: true }));
  assertEquals(texts(s), []);
  offer.update(state({}));
  assertEquals(texts(s), [MIGRATION_TEXT]);
  assertEquals(s.items.value[0]?.actions?.map((a) => a.label), ["Migrate", "Not now"]);
  offer.update(state({})); // a live refresh of the same folder: still one offer
  assertEquals(texts(s), [MIGRATION_TEXT]);
});

Deno.test("Not now hides the offer until the folder is opened again", () => {
  using _time = new FakeTime();
  const s = new ToastStore();
  const offer = new MigrationOffer(s, () => Promise.resolve({ projects: [] }), () => {});
  offer.update(state({}));
  s.items.value[0]!.actions![1]!.run();
  assertEquals(texts(s), []);
  offer.update(state({}));
  assertEquals(texts(s), [], "not again while the same folder stays open");
  offer.update(state({ dir: "/code/b", lastDir: "/code/b" }));
  offer.update(state({}));
  assertEquals(texts(s), [MIGRATION_TEXT], "back when the folder is opened again");
});

Deno.test("Migrate moves the data and reports it; a failure changes nothing", async () => {
  using _time = new FakeTime();
  const s = new ToastStore();
  const moved: string[][] = [];
  const ok = new MigrationOffer(s, () => Promise.resolve({ projects: ["hx-a-001"] }), (p) => {
    moved.push(p);
  });
  ok.update(state({}));
  s.items.value[0]!.actions![0]!.run();
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(moved, [["hx-a-001"]]);
  assertEquals(texts(s), ["Moved hx-a-001 to ~/.hx/projects"]);

  const s2 = new ToastStore();
  const bad = new MigrationOffer(s2, () => Promise.reject(new Error("already exists")), () => {
    throw new Error("must not be called");
  });
  bad.update(state({}));
  s2.items.value[0]!.actions![0]!.run();
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(s2.items.value.map((t) => [t.text, t.kind]), [["already exists", "failure"]]);
});
