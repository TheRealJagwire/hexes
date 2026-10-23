import { assertEquals } from "@std/assert";
import type { Hex, Status } from "../src/shared/schemas.ts";
import { diffUnblocked, formatEvent } from "../src/shared/unblocked.ts";

let n = 0;
function hex(
  id: string,
  kind: string,
  status: Status,
  dependsOn: string[] = [],
  meta?: Record<string, string>,
): Hex {
  n++;
  const h: Hex = {
    id,
    title: `Title ${id}`,
    description: "",
    kind,
    status,
    createdAtTimeInMs: n,
    lastUpdatedAtTimeInMs: n,
  };
  if (dependsOn.length) h.dependsOn = dependsOn;
  if (meta) h.meta = meta;
  return h;
}

/** `hexes` with the given ids changed to new statuses (and optional meta). */
function change(
  hexes: Hex[],
  to: Record<string, Status>,
  meta: Record<string, Record<string, string>> = {},
): Hex[] {
  return hexes.map((h) =>
    to[h.id] ? { ...h, status: to[h.id]!, ...(meta[h.id] ? { meta: meta[h.id] } : {}) } : h
  );
}

const project = () => [
  hex("hx-p-001", "core.project", "done"),
  hex("hx-p-0d1", "core.design", "blocked", ["hx-p-001"]),
  hex("hx-p-0f5", "core.spec", "blocked", ["hx-p-0d1"]),
  hex("hx-p-0a1", "core.story", "blocked", ["hx-p-0f5"]),
  hex("hx-p-0a2", "core.story", "blocked", ["hx-p-0f5"]),
  hex("hx-p-0e1", "core.epic", "blocked", ["hx-p-0a1", "hx-p-0a2"]),
];

const ids = (hexes: readonly Hex[]) => hexes.map((h) => h.id);

Deno.test("a blessed design is reported, with nothing newly ready", () => {
  const before = project();
  const [u, ...rest] = diffUnblocked(before, change(before, { "hx-p-0d1": "blessed" }));
  assertEquals(rest, []);
  assertEquals(u!.projectId, "hx-p-001");
  assertEquals(ids(u!.blessed), ["hx-p-0d1"]);
  assertEquals(u!.answered, []);
  assertEquals(u!.ready, [], "specs wait for a person, so nothing is ready yet");
});

Deno.test("a blessed spec is reported with the stories it made ready", () => {
  const before = change(project(), { "hx-p-0d1": "blessed" });
  const after = change(before, { "hx-p-0f5": "blessed", "hx-p-0a1": "ready", "hx-p-0a2": "ready" });
  const [u] = diffUnblocked(before, after);
  assertEquals(ids(u!.blessed), ["hx-p-0f5"]);
  assertEquals(ids(u!.ready), ["hx-p-0a1", "hx-p-0a2"]);
});

Deno.test("an answered question is reported with its answer and decision", () => {
  const before = [
    ...project(),
    hex("hx-p-0c9", "core.question", "ready", ["hx-p-001"]),
    hex("hx-p-0b1", "core.bug", "blocked", ["hx-p-0c9"]),
  ];
  const after = [
    ...change(before, { "hx-p-0c9": "answered", "hx-p-0b1": "ready" }, {
      "hx-p-0c9": { answer: "Push, over a channel", decision: "hx-p-0c1" },
    }),
    hex("hx-p-0c1", "core.decision", "done", ["hx-p-0c9"]),
  ];
  const [u] = diffUnblocked(before, after);
  assertEquals(u!.blessed, []);
  assertEquals(u!.answered.length, 1);
  assertEquals(u!.answered[0]!.question.id, "hx-p-0c9");
  assertEquals(u!.answered[0]!.answer, "Push, over a channel");
  assertEquals(u!.answered[0]!.decision?.id, "hx-p-0c1");
  assertEquals(ids(u!.ready), ["hx-p-0b1"]);
});

Deno.test("a missing decision is null", () => {
  const before = [...project(), hex("hx-p-0c9", "core.question", "ready", ["hx-p-001"])];
  const after = change(before, { "hx-p-0c9": "answered" }, {
    "hx-p-0c9": { answer: "Yes", decision: "hx-p-fff" },
  });
  assertEquals(diffUnblocked(before, after)[0]!.answered[0]!.decision, null);
});

Deno.test("a hex made blessed counts; one already blessed doesn't", () => {
  const before = change(project(), { "hx-p-0d1": "blessed" });
  const after = [...before, hex("hx-p-0d2", "core.design", "blessed", ["hx-p-001"])];
  assertEquals(ids(diffUnblocked(before, after)[0]!.blessed), ["hx-p-0d2"]);
  assertEquals(diffUnblocked(before, before), []);
});

Deno.test("a change where only readiness moved gives nothing", () => {
  const before = change(project(), { "hx-p-0d1": "blessed", "hx-p-0f5": "blessed" });
  const after = change(before, { "hx-p-0a1": "ready", "hx-p-0a2": "done" });
  assertEquals(diffUnblocked(before, after), []);
});

Deno.test("one entry per project, ordered by project id", () => {
  const before = [
    ...project(),
    hex("hx-a-001", "core.project", "done"),
    hex("hx-a-0d1", "core.design", "blocked", ["hx-a-001"]),
  ];
  const after = change(before, { "hx-p-0d1": "blessed", "hx-a-0d1": "blessed" });
  const out = diffUnblocked(before, after);
  assertEquals(out.map((u) => u.projectId), ["hx-a-001", "hx-p-001"]);
  assertEquals(out.map((u) => ids(u.blessed)), [["hx-a-0d1"], ["hx-p-0d1"]]);
});

Deno.test("studio hexes are ignored", () => {
  const before = [...project(), hex("hx-p-0f1", "studio.design", "blocked", ["hx-p-001"])];
  assertEquals(diffUnblocked(before, change(before, { "hx-p-0f1": "blessed" })), []);
});

Deno.test("formatEvent: lines and meta", () => {
  const before = [
    ...change(project(), { "hx-p-0d1": "blessed" }),
    hex("hx-p-0c9", "core.question", "ready", ["hx-p-001"]),
  ];
  const after = [
    ...change(before, { "hx-p-0f5": "blessed", "hx-p-0a1": "ready", "hx-p-0c9": "answered" }, {
      "hx-p-0c9": { answer: "Push", decision: "hx-p-0c1" },
    }),
    hex("hx-p-0c1", "core.decision", "done", ["hx-p-0c9"]),
  ];
  const { content, meta } = formatEvent(diffUnblocked(before, after)[0]!);
  assertEquals(content.split("\n"), [
    'Blessed: spec hx-p-0f5 "Title hx-p-0f5"',
    'Answered: question hx-p-0c9 "Title hx-p-0c9" → decision hx-p-0c1: "Push"',
    'Now ready: hx-p-0a1 (story) "Title hx-p-0a1"',
  ]);
  assertEquals(meta, {
    project: "hx-p-001",
    event: "unblocked",
    blessed: "hx-p-0f5",
    answered: "hx-p-0c9",
    ready: "hx-p-0a1",
  });
  for (const key of Object.keys(meta)) assertEquals(/^\w+$/.test(key), true, key);
});

Deno.test("formatEvent: empty lists and a long, multi-line answer", () => {
  const blessedOnly = formatEvent({
    projectId: "hx-p-001",
    blessed: [hex("hx-p-0d1", "core.design", "blessed")],
    answered: [],
    ready: [],
  });
  assertEquals(blessedOnly.content.split("\n"), [
    'Blessed: design hx-p-0d1 "Title hx-p-0d1"',
    "Now ready: none yet",
  ]);
  assertEquals(blessedOnly.meta, { project: "hx-p-001", event: "unblocked", blessed: "hx-p-0d1" });

  const long = `${"word ".repeat(40)}\nsecond line`;
  const answered = formatEvent({
    projectId: "hx-p-001",
    blessed: [],
    answered: [{
      question: hex("hx-p-0c9", "core.question", "answered"),
      answer: long,
      decision: null,
    }],
    ready: [],
  });
  const line = answered.content.split("\n")[0]!;
  const quoted = line.slice(line.indexOf(': "') + 3, -1);
  assertEquals(quoted.endsWith("…"), true);
  assertEquals(quoted.length <= 120, true);
  assertEquals(line.includes("second line"), false);
  assertEquals(line.includes("→"), false, "no decision, no arrow");
});
