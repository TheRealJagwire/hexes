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
  epics: EpicView[];
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
  /** What deleting this hex would touch, for the confirmation copy. */
  deleteImpact: {
    dependents: number;
    emerged: number;
    /** Set when the hex is a project: every hex in the project is deleted too. */
    projectHexes: number | null;
  };
}

export interface CreateProjectResult {
  projectId: string;
  warnings: string[];
}

export interface ApiError {
  error: string;
}
