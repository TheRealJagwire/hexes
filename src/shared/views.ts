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
  decisions: HexSummary[];
  questions: HexSummary[];
  epics: EpicView[];
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
