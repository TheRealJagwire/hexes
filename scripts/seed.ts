// Writes a sample project (modelled on the design comps) to ./examples/sample, then points
// Studio at it. Run with: deno task seed
import type { Hex, Status } from "../src/shared/schemas.ts";
import { HexService } from "../src/server/core/service.ts";
import { Workspace } from "../src/server/core/workspace.ts";

const dir = new URL("../examples/sample", import.meta.url).pathname;
await Deno.remove(dir, { recursive: true }).catch(() => {});

const service = new HexService(Workspace.fromEnv());

async function project(title: string, statement: string) {
  const { projectId } = await service.createProject({
    dir,
    title,
    description: statement,
    gitInit: false,
  });
  return projectId;
}

// The sample lives in one data.json, so the first project is created through the service and
// the others are appended with the same file API.
const studio = await project(
  "Hexes Studio",
  "A project state tracking system built from hexes — atomic tracked things that index any piece of " +
    "project data: visions, PRD elements, epics, stories, bugs and sessions. Studio is the UI for " +
    "working with them, and every action is also exposed over MCP.",
);

let seq = 0;
async function hex(
  kind: string,
  title: string,
  status: Status,
  extra: {
    dependsOn?: string[];
    description?: string;
    meta?: Record<string, string>;
    emergedFrom?: string;
  } = {},
): Promise<Hex> {
  seq++;
  return await service.createHex({
    projectId: studio,
    kind,
    title,
    description: extra.description ?? "",
    status,
    requiredBy: [],
    dependsOn: extra.dependsOn ?? [],
    meta: extra.meta ?? {},
    ...(extra.emergedFrom ? { emergedFrom: extra.emergedFrom } : {}),
  });
}

await service.setMeta(studio, "git branch", "main");
await service.setMeta(studio, "desired_language", "typescript");

const ia = await hex("core.design", "Studio information architecture", "done", {
  dependsOn: [studio],
});
const model = await hex("core.design", "Hex data model and id hashing", "done", {
  dependsOn: [studio],
});
await hex("core.decision", "Store all hexes in a single .hx/data.json", "done", {
  dependsOn: [ia.id],
});
await hex("core.decision", "Id hash = title + kind + createdAtTimeInMs", "done", {
  dependsOn: [model.id],
});
await hex("core.decision", "Every Studio action is also an MCP tool", "in_progress", {
  dependsOn: [ia.id],
});
const spec = await hex("core.spec", "Ring progress spec", "done", { dependsOn: [model.id] });

const progressRing = await hex("core.substory", "ProgressRing component", "done", {
  dependsOn: [spec.id],
});

// Project screen
await hex("core.story", "Project hero with title, statement and id", "done", {
  description: "Hero card for the core.project hex.",
  meta: { files_to_touch: "src/client/screens/Project.tsx" },
});
const accordion = await hex("core.story", "Epic accordion with circular progress", "in_progress", {
  dependsOn: [progressRing.id],
  description:
    "Each epic is a top-level accordion showing its id, title, and the share of stories it depends on that are done, as a ring, a percentage and a fraction.",
  meta: {
    "git branch": "feat/epic-accordion",
    "git worktree": "../hexes-epic-accordion",
    desired_language: "typescript",
    desired_spec: model.id,
    files_to_touch: "src/client/screens/Project.tsx, src/client/components/Bits.tsx",
  },
});
await hex("core.story", "Sort done stories to the bottom", "ready", {
  description: "Inside an expanded epic, stories in done status sink below all others.",
});
await hex("core.story", "Collapsed design and decision accordions", "done", {
  description: "Two collapsed groups under the hero.",
});
const create = await hex("core.story", "Create Hex button and form", "blocked", {
  description: "Waiting on the kind registry so the form can list core.* and studio.* kinds.",
  emergedFrom: accordion.id,
  meta: { desired_language: "typescript" },
});
const projectScreenStories = (await service.search({ projectId: studio, kind: "core.story" }))
  .map((h) => h.id);
const projectScreen = await hex("core.epic", "Project screen", "in_progress", {
  dependsOn: [...projectScreenStories, spec.id],
});

// First run and project list
const firstRunStories: string[] = [];
for (
  const t of [
    "Open existing .hx directory",
    "Create project, git init, project hex",
    "Restore studio.selected_project",
    "Project list from data.json",
  ]
) firstRunStories.push((await hex("core.story", t, "done")).id);
const firstRun = await hex("core.epic", "First run and project list", "done", {
  dependsOn: firstRunStories,
});

// MCP
const mcp: [string, Status][] = [
  ["get_hex_by_id", "done"],
  ["get_ready_hexes / get_ready_hexes_for_project", "ready"],
  ["Dependency traversal tools", "ready"],
  ["add / update meta state tools", "blocked"],
  ["Mirror Studio create / update / delete", "blocked"],
  ["Tool schema docs", "blocked"],
];
const mcpStories: string[] = [];
for (const [t, s] of mcp) mcpStories.push((await hex("core.story", t, s)).id);
const mcpEpic = await hex("core.epic", "MCP server", "blocked", { dependsOn: mcpStories });

await hex("core.gate", "Alpha", "blocked", { dependsOn: [projectScreen.id, firstRun.id] });
await hex("core.gate", "Beta", "blocked", { dependsOn: [mcpEpic.id] });
await hex("core.bug", "Meta table overflows on narrow screens", "ready", {
  emergedFrom: create.id,
});

// Two small sibling projects so the project list has something to pick from.
for (
  const [title, statement] of [
    ["Docs site", "Public documentation for the hex data model and conventions."],
    ["Markdown importer", "Convert existing PRDs and issue lists into hexes."],
  ] as const
) {
  const file = await service.workspace.file();
  await file.mutate(async (hexes) => {
    const t = Date.now() + hexes.length;
    const { generateId, derivePrefix } = await import("../src/server/core/ids.ts");
    const prefixes = new Set(hexes.map((h) => h.id.split("-").slice(1, -1).join("-")));
    const prefix = derivePrefix(title, prefixes);
    const g = await generateId(prefix, title, "core.project", t, new Set(hexes.map((h) => h.id)));
    hexes.push({
      id: g.id,
      title,
      description: statement,
      kind: "core.project",
      createdAtTimeInMs: g.createdAtTimeInMs,
      lastUpdatedAtTimeInMs: g.createdAtTimeInMs,
      status: "done",
    });
  });
}
await service.selectProject(studio);

console.log(`Seeded ${seq} hexes in ${dir}/.hx/data.json (selected: ${studio})`);
