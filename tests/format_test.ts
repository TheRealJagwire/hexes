import { assertEquals } from "@std/assert";
import { createStatusOptions, statusOptions } from "../src/client/lib/format.ts";

Deno.test("status menus leave out what pull requests set, unless it is the current status", () => {
  assertEquals(statusOptions("core.story"), ["blocked", "ready", "in_progress", "done"]);
  assertEquals(statusOptions("core.story", "in_review"), [
    "in_review",
    "blocked",
    "ready",
    "in_progress",
    "done",
  ]);
  assertEquals(statusOptions("core.bug", "merged")[0], "merged");
  assertEquals(statusOptions("core.epic"), ["blocked", "ready", "in_progress", "verified", "done"]);
  // A story from before work followed pull requests keeps showing what it was.
  assertEquals(statusOptions("core.story", "verified")[0], "verified");
});

Deno.test("a new hex never starts in review or merged", () => {
  assertEquals(createStatusOptions("core.story"), ["blocked", "ready", "in_progress", "done"]);
  assertEquals(createStatusOptions("x.task"), ["blocked", "ready", "in_progress", "done"]);
  assertEquals(createStatusOptions("core.question"), ["blocked", "ready", "in_progress"]);
});
