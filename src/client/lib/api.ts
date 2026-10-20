import type {
  CreateHexRequest,
  CreateProjectRequest,
  Hex,
  UpdateHexRequest,
} from "../../shared/schemas.ts";
import type {
  ApiError,
  CreateProjectResult,
  HexSummary,
  HexView,
  InspectResult,
  ProjectGraph,
  ProjectSummary,
  ProjectView,
  PullRequestDiff,
  RecentProject,
  WorkspaceState,
} from "../../shared/views.ts";

export class ApiFailure extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (json as ApiError | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiFailure(message, res.status);
  }
  return json as T;
}

type CreateHexInput =
  & Omit<CreateHexRequest, "description" | "status" | "requiredBy" | "dependsOn" | "meta">
  & {
    description: string;
    status: CreateHexRequest["status"];
    requiredBy: string[];
    dependsOn: string[];
    meta: Record<string, string>;
  };

export const api = {
  state: () => request<WorkspaceState>("GET", "/state"),
  inspect: (dir: string) => request<InspectResult>("POST", "/workspace/inspect", { dir }),
  openWorkspace: (dir: string) => request<WorkspaceState>("POST", "/workspace/open", { dir }),
  createProject: (req: CreateProjectRequest) =>
    request<CreateProjectResult>("POST", "/workspace/create", req),
  pickDirectory: () => request<{ dir: string | null }>("POST", "/workspace/pick", {}),
  projects: () => request<ProjectSummary[]>("GET", "/projects"),
  project: (id: string) => request<ProjectView>("GET", `/projects/${id}`),
  projectGraph: (id: string) => request<ProjectGraph>("GET", `/projects/${id}/graph`),
  selectProject: (id: string) => request<{ ok: true }>("POST", "/selected-project", { id }),
  recentProjects: () => request<RecentProject[]>("GET", "/projects/recent"),
  /** Opens the project's folder when needed and selects it, in one step. */
  openRecentProject: (dir: string, projectId: string) =>
    request<WorkspaceState>("POST", "/projects/open", { dir, projectId }),
  forgetRecentProject: (dir: string, projectId: string) =>
    request<{ ok: true }>("POST", "/projects/recent/forget", { dir, projectId }),
  hex: (id: string) => request<HexView>("GET", `/hexes/${id}`),
  /** Every searchable hex in a project (up to 1,000), for client-side pickers. */
  projectHexes: (projectId: string) =>
    request<HexSummary[]>("GET", `/hexes?project=${encodeURIComponent(projectId)}&limit=1000`),
  createHex: (req: CreateHexInput) => request<Hex>("POST", "/hexes", req),
  updateHex: (id: string, patch: UpdateHexRequest) => request<Hex>("PATCH", `/hexes/${id}`, patch),
  deleteHex: (id: string) => request<{ deleted: string[] }>("DELETE", `/hexes/${id}`),
  setMeta: (id: string, key: string, value: string) =>
    request<Hex>("PUT", `/hexes/${id}/meta/${encodeURIComponent(key)}`, { value }),
  removeMeta: (id: string, key: string) =>
    request<Hex>("DELETE", `/hexes/${id}/meta/${encodeURIComponent(key)}`),
  /** Puts a work hex on its own branch (and switches the working tree to it). */
  startWork: (id: string) => request<Hex>("POST", `/hexes/${id}/branch`, {}),
  openPullRequest: (id: string, opts: { title?: string; description?: string } = {}) =>
    request<Hex>("POST", `/hexes/${id}/pull-requests`, opts),
  mergePullRequest: (id: string) => request<Hex>("POST", `/hexes/${id}/merge`, {}),
  closePullRequest: (id: string) => request<Hex>("POST", `/hexes/${id}/close`, {}),
  pullRequestDiff: (id: string) => request<PullRequestDiff>("GET", `/hexes/${id}/diff`),
};
