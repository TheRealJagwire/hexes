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
}

export interface EpicView {
  hex: Hex;
  gate: HexSummary | null;
  progress: Progress;
  /** Stories this epic depends on, sorted in_progress → verified → ready → blocked → done. */
  stories: Hex[];
}

export interface ProjectView {
  project: Hex;
  designs: HexSummary[];
  specs: HexSummary[];
  decisions: HexSummary[];
  questions: HexSummary[];
  epics: EpicView[];
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
}
