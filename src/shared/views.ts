import type { KindWorkflow, StatusInfo } from "./constants.ts";
import type { Hex, Status } from "./schemas.ts";

/** Compact hex reference used in lists, breadcrumbs and relationship panels. */
export interface HexSummary {
  id: string;
  title: string;
  kind: string;
  status: Status;
}

export interface Progress {
  done: number;
  total: number;
  /** 0-100, rounded. */
  pct: number;
}

export interface WorkspaceState {
  dir: string | null;
  /** True when the directory is fixed by the HEXES_DIR environment variable. */
  pinned: boolean;
  /** The directory used last time, offered as a default on the welcome screen. */
  lastDir: string | null;
  selectedProjectId: string | null;
  /** 2 when the selected project lives in ~/.hx/projects/<id>; 1 for a folder's `.hx/data.json`. */
  schemaVersion: 1 | 2;
  /** The git working tree the selected project works on, when known. */
  repoPath: string | null;
  /** The data file being worked on (`~/.hx/projects/<id>/data.json` or `<dir>/.hx/data.json`). */
  dataPath: string | null;
}

/** A workspace the server has opened before. Clients treat `id` as opaque; `dir` is detail. */
export interface RecentWorkspace {
  id: string;
  label: string;
  dir: string;
  /** False when the directory no longer has a readable data file. */
  found: boolean;
}

export interface InspectResult {
  dir: string;
  found: boolean;
  hexCount: number;
  projectCount: number;
  error?: string | undefined;
}

export interface ProjectSummary {
  id: string;
  title: string;
  blurb: string;
  initial: string;
  epics: number;
  stories: number;
  /** Still in a folder's `.hx/data.json` (schema v1), not yet moved to ~/.hx/projects. */
  needsMigration: boolean;
  /** The git working tree it works on: `meta.repo_path`, or the folder of a v1 project. */
  repoPath: string | null;
  /** Its data file. */
  dataPath: string;
}

export interface EpicView {
  hex: Hex;
  gate: HexSummary | null;
  progress: Progress;
  /** Stories this epic depends on, sorted in_progress → verified → ready → blocked → done. */
  stories: Hex[];
}

/** A milestone on the project stepper. */
export interface GateView {
  hex: HexSummary;
  /** The gate's epics finished (or archived) out of all of them. */
  epics: Progress;
}

export interface ProjectView {
  project: Hex;
  /** Gates in milestone order (`sortGates`): done ones first, never before a gate they follow. */
  gates: GateView[];
  designs: HexSummary[];
  specs: HexSummary[];
  decisions: HexSummary[];
  questions: HexSummary[];
  /** Ideas, newest first. */
  ideas: HexSummary[];
  /** Facts, newest first, retired ones included. */
  facts: HexSummary[];
  epics: EpicView[];
  /** Pull requests are merged as soon as they are opened, and other branches updated. */
  autoMerge: boolean;
}

/** A hex as one cell of the project hex map. */
export interface GraphNode {
  id: string;
  title: string;
  kind: string;
  status: Status;
  /** First sentence of the description, as plain text. */
  blurb: string;
  /** `meta.git_branch`, set on work hexes once work has started on a branch. */
  gitBranch: string | null;
  updatedAt: number;
}

/** `from` depends on `to`. */
export interface GraphEdge {
  from: string;
  to: string;
}

/** Every hex in a project and the dependency links between them, for the hex map. */
export interface ProjectGraph {
  projectId: string;
  /** The project first, then by creation time. */
  nodes: GraphNode[];
  /** Only links with both ends in this project. */
  edges: GraphEdge[];
}

/** A pull request as listed on its work hex. */
export interface PullRequestSummary extends HexSummary {
  sourceBranch: string;
  targetBranch: string;
  /** Set once merged. */
  mergeSha: string | null;
  /** Open only: files the branch was last found to conflict in with its target (`meta.merge_conflicts`). */
  conflicts: string[];
}

export interface HexView {
  hex: Hex;
  /** Root-first trail: project › gate › epic › … › this hex (last item is the hex itself). */
  breadcrumbs: HexSummary[];
  projectId: string | null;
  dependsOn: HexSummary[];
  dependedOnBy: HexSummary[];
  emergedFromHex: HexSummary | null;
  emergedHere: HexSummary[];
  /** For a work hex: the branch its work is on (`meta.git_branch`), or null. */
  workBranch: string | null;
  /** For a work hex: its pull requests, newest first. */
  pullRequests: PullRequestSummary[];
  /** For a pull request: the work hex it was opened for, or null. */
  workHex: HexSummary | null;
  /** Facts about this hex (that depend on it), newest first; left out of `dependedOnBy`. */
  facts: HexSummary[];
  /** Whether the hex's project merges pull requests as soon as they are opened. */
  autoMerge: boolean;
  /** What deleting this hex would touch, for the confirmation copy. */
  deleteImpact: {
    dependents: number;
    emerged: number;
    /** Set when the hex is a project: every hex in the project is deleted too. */
    projectHexes: number | null;
    /** Pull requests opened for this hex; they are kept, and lose their link to it. */
    pullRequests: number;
  };
}

export interface CreateProjectResult {
  projectId: string;
  warnings: string[];
}

export interface ApiError {
  error: string;
}

/** `GET /api/statuses`: what each status means and which statuses each kind allows. */
export interface StatusTable {
  statuses: Record<Status, StatusInfo>;
  /** Kinds whose lifecycle differs from `default`. */
  kinds: Record<string, KindWorkflow>;
  default: KindWorkflow;
  /** Statuses that are only set together with a `response` (answering a question). */
  requiresResponse: readonly Status[];
  /** Statuses only pull requests set (`in_review`, `merged`): never offered in a status menu. */
  derived: readonly Status[];
}

export interface DiffLine {
  kind: "context" | "add" | "del";
  /** Line number in the old file; null for an added line. */
  oldNo: number | null;
  /** Line number in the new file; null for a removed line. */
  newNo: number | null;
  text: string;
}

export interface DiffHunk {
  /** The `@@ -a,b +c,d @@ …` line. */
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  /** The path before a rename; null otherwise. */
  oldPath: string | null;
  status: "added" | "deleted" | "renamed" | "modified";
  additions: number;
  deletions: number;
  binary: boolean;
  /** Empty for binary files, and for every file when the diff was truncated. */
  hunks: DiffHunk[];
}

/** `GET /api/hexes/:id/diff` for a pull request. */
export interface PullRequestDiff {
  files: DiffFile[];
  /** Too large to show in full: files and counts only, no hunks. */
  truncated: boolean;
  /** `git` when computed from the commits; `snapshot` when they are gone and the saved patch is used. */
  source: "git" | "snapshot";
}

/** `GET /api/projects/recent`: a project opened before, in this folder or another. */
export interface RecentProject {
  /** The v1 folder holding it, or a v2 project's repo_path ("" when it has none). */
  dir: string;
  projectId: string;
  /** The project's title now when its folder is readable, else as last seen. */
  title: string;
  /** The folder's name, for display. */
  folder: string;
  openedAt: number;
  /** The folder still has a data file with this project in it. */
  found: boolean;
  /** It is the open folder's selected project. */
  current: boolean;
  /** False when HEXES_DIR pins Studio to another folder. */
  switchable: boolean;
  /** Still in a folder's `.hx/data.json` (schema v1). */
  needsMigration: boolean;
}

/** Which facts to fetch: every filter given must hold. */
export interface FactsQuery {
  /** Only facts within `depth` hops of this hex, over links in both directions. */
  near?: string | undefined;
  /** Hops from `near`: 1–4, default 2. */
  depth?: number | undefined;
  /** Only facts whose `meta.files` lists this repo path. */
  file?: string | undefined;
  /** Only facts whose title matches, as in hex search. */
  query?: string | undefined;
  /** Retired facts too; otherwise only known ones. */
  includeRetired?: boolean | undefined;
}

/** One fact found by `GET /api/projects/:id/facts` or MCP `get_facts`. */
export interface FactHit {
  fact: Hex;
  /** Hops from `near`, or null when `near` wasn't given. */
  distance: number | null;
  /** From `near` to the fact, both ends included; empty when `near` wasn't given. */
  path: HexSummary[];
}

export interface FactsResult {
  /** Nearest first when `near` was given, then newest; otherwise newest first. */
  facts: FactHit[];
}

/** One event a channel sent into its Claude session, per hex it named. */
export interface ChannelSend {
  hexId: string;
  /** What the person did: `published`, `blessed` or `answered`. */
  event: string;
  at: number;
}

/** A `hexes-channel` process listening on the open workspace. */
export interface ChannelInfo {
  pid: number;
  startedAt: number;
  heartbeatAt: number;
  /** The latest sends, oldest first (at most 20). */
  sent: ChannelSend[];
}

/** `GET /api/channels` and the `channel` event: the channels listening now. */
export interface ChannelsState {
  channels: ChannelInfo[];
}

/** One MCP tool call an agent made through Studio. */
export interface AgentCall {
  tool: string;
  /** A read-only tool: it counts as the agent being there, not as working on a hex. */
  read: boolean;
  /** The hex it was about (its `id`, the hex it created, or its `project_id`), if any. */
  hexId: string | null;
  at: number;
}

/** `GET /api/agent?project=…`: what agents have been doing in a project. */
export interface AgentActivity {
  /** The latest call about this project, or about no hex at all. */
  lastCall: AgentCall | null;
  /** The hex an agent changed most recently, in the last ten minutes. */
  working: { hexId: string; tool: string; at: number } | null;
}
