import {
  breadcrumbs,
  buildIndex,
  byCreated,
  dependenciesDone,
  dependenciesOf,
  dependentsOf,
  epicStories,
  findCycle,
  findProject,
  type HexIndex,
  prefixOf,
  progressOf,
  projectHexes,
  projects,
  pullRequestsOf,
  readyHexes,
  reconcileReadiness,
  summarize,
} from "../../shared/graph.ts";
import { allowedStatuses, REQUIRES_RESPONSE, roleOf, satisfies } from "../../shared/constants.ts";
import {
  type CreateHexRequest,
  type CreateProjectRequest,
  type Hex,
  SELECTED_PROJECT_KIND,
  SELECTED_PROJECT_PREFIX,
  type Status,
  type UpdateHexRequest,
} from "../../shared/schemas.ts";
import type {
  CreateProjectResult,
  EpicView,
  HexSummary,
  HexView,
  InspectResult,
  ProjectSummary,
  ProjectView,
  RecentWorkspace,
  WorkspaceState,
} from "../../shared/views.ts";
import { DomainError } from "./errors.ts";
import { derivePrefix, generateId } from "./ids.ts";
import { HexFile } from "./store.ts";
import { gitInit, resolveDir, type Workspace } from "./workspace.ts";

export interface SearchQuery {
  projectId?: string | undefined;
  query?: string | undefined;
  kind?: string | undefined;
  status?: Status | undefined;
  limit?: number | undefined;
}

export type MetaMode = "add" | "update" | "set";

/** Every Studio action, written once and shared by the HTTP API and the MCP server. */
export class HexService {
  constructor(
    readonly workspace: Workspace,
    private readonly now: () => number = Date.now,
  ) {}

  // ── workspace ────────────────────────────────────────────────────────────

  async state(): Promise<WorkspaceState> {
    const dir = await this.workspace.current();
    let selectedProjectId: string | null = null;
    if (dir) selectedProjectId = selectedProjectOf(buildIndex(await new HexFile(dir).read()));
    return {
      dir,
      pinned: this.workspace.pinnedDir !== null,
      lastDir: await this.workspace.lastDir(),
      selectedProjectId,
    };
  }

  inspect(dir: string): Promise<InspectResult> {
    return this.workspace.inspect(dir);
  }

  async recentWorkspaces(): Promise<RecentWorkspace[]> {
    const out: RecentWorkspace[] = [];
    for (const dir of await this.workspace.recent()) {
      const info = await this.workspace.inspect(dir);
      out.push({
        id: dir,
        label: dir.split("/").filter(Boolean).pop() ?? dir,
        dir,
        found: info.found,
      });
    }
    return out;
  }

  async openWorkspace(dir: string): Promise<WorkspaceState> {
    await this.workspace.open(dir);
    return this.state();
  }

  async createProject(req: CreateProjectRequest): Promise<CreateProjectResult> {
    if (this.workspace.pinnedDir) {
      throw new DomainError(
        `The directory is pinned to ${this.workspace.pinnedDir} by HEXES_DIR`,
        409,
      );
    }
    const dir = resolveDir(req.dir);
    const file = new HexFile(dir);
    if (await file.exists()) {
      throw new DomainError(`${dir} already has a .hx/data.json. Open it instead.`, 409);
    }
    try {
      await Deno.mkdir(dir, { recursive: true });
    } catch (e) {
      throw new DomainError(`Cannot create ${dir}: ${e instanceof Error ? e.message : e}`, 400);
    }
    const t = this.now();
    const projectId = await file.mutate(async (hexes) => {
      const prefix = derivePrefix(req.title, new Set());
      const project = await this.newHex(hexes, {
        prefix,
        kind: "core.project",
        title: req.title,
        description: req.description,
        // A stated vision is a finished artifact; designs and the rest hang off it.
        status: "done",
        createdAt: t,
      });
      await this.writeSelected(hexes, project.id);
      return project.id;
    }, { create: true });
    const warnings: string[] = [];
    if (req.gitInit) {
      const warning = await gitInit(dir);
      if (warning) warnings.push(warning);
    }
    await this.workspace.remember(dir);
    return { projectId, warnings };
  }

  // ── projects ─────────────────────────────────────────────────────────────

  private async index(): Promise<HexIndex> {
    return buildIndex(await (await this.workspace.file()).read());
  }

  private async mutate<T>(fn: (hexes: Hex[]) => T | Promise<T>): Promise<T> {
    return (await this.workspace.file()).mutate(fn);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const idx = await this.index();
    return projects(idx).map((p) => {
      const prefix = prefixOf(p.id);
      const own = prefix ? projectHexes(idx, prefix) : [];
      return {
        id: p.id,
        title: p.title,
        blurb: blurb(p.description),
        initial: initials(p.title),
        epics: own.filter((h) => h.kind === "core.epic").length,
        stories: own.filter((h) => h.kind === "core.story").length,
      };
    });
  }

  async selectedProjectId(): Promise<string | null> {
    return selectedProjectOf(await this.index());
  }

  async selectProject(id: string): Promise<void> {
    await this.mutate(async (hexes) => {
      const project = hexes.find((h) => h.id === id && h.kind === "core.project");
      if (!project) throw new DomainError(`No project with id ${id}`, 404);
      await this.writeSelected(hexes, id);
    });
  }

  async projectView(id: string): Promise<ProjectView> {
    const idx = await this.index();
    const project = idx.byId.get(id);
    if (!project || project.kind !== "core.project") {
      throw new DomainError(`No project with id ${id}`, 404);
    }
    const own = projectHexes(idx, prefixOf(id) ?? "").sort(byCreated);
    const epics: EpicView[] = own.filter((h) => h.kind === "core.epic").map((epic) => {
      const gate = dependentsOf(idx, epic.id).find((d) => d.kind === "core.gate");
      const stories = epicStories(idx, epic);
      return {
        hex: epic,
        gate: gate ? summarize(gate) : null,
        progress: progressOf(stories),
        stories,
      };
    });
    return {
      project,
      designs: own.filter((h) => h.kind === "core.design").map(summarize),
      decisions: own.filter((h) => h.kind === "core.decision").map(summarize),
      questions: own.filter((h) => h.kind === "core.question").map(summarize),
      epics,
    };
  }

  // ── reading hexes ────────────────────────────────────────────────────────

  private require(idx: HexIndex, id: string): Hex {
    const hex = idx.byId.get(id);
    if (!hex) throw new DomainError(`No hex with id ${id}`, 404);
    return hex;
  }

  async getHex(id: string): Promise<Hex> {
    return this.require(await this.index(), id);
  }

  async hexView(id: string): Promise<HexView> {
    const idx = await this.index();
    const hex = this.require(idx, id);
    const prefix = prefixOf(id);
    const emergedHere = idx.hexes.filter((h) => h.emergedFrom === id).sort(byCreated);
    const dependents = dependentsOf(idx, id);
    const emergedFromHex = hex.emergedFrom ? idx.byId.get(hex.emergedFrom) : undefined;
    const pullRequests = pullRequestsOf(idx, id);
    const workHex = hex.meta?.work_hex ? idx.byId.get(hex.meta.work_hex) : undefined;
    return {
      hex,
      breadcrumbs: breadcrumbs(idx, hex).map(summarize),
      projectId: (prefix && findProject(idx, prefix)?.id) || null,
      dependsOn: dependenciesOf(idx, hex).map(summarize),
      dependedOnBy: dependents.map(summarize),
      emergedFromHex: emergedFromHex ? summarize(emergedFromHex) : null,
      emergedHere: emergedHere.map(summarize),
      workBranch: hex.meta?.git_branch ?? null,
      pullRequests: pullRequests.map((pr) => ({
        ...summarize(pr),
        sourceBranch: pr.meta?.source_branch ?? "",
        targetBranch: pr.meta?.target_branch ?? "",
        mergeSha: pr.meta?.merge_sha ?? null,
      })),
      workHex: workHex ? summarize(workHex) : null,
      deleteImpact: {
        dependents: dependents.length,
        emerged: emergedHere.length,
        projectHexes: hex.kind === "core.project" && prefix
          ? projectHexes(idx, prefix).length
          : null,
        pullRequests: pullRequests.length,
      },
    };
  }

  async breadcrumbsOf(id: string): Promise<HexSummary[]> {
    const idx = await this.index();
    return breadcrumbs(idx, this.require(idx, id)).map(summarize);
  }

  async search(q: SearchQuery = {}): Promise<HexSummary[]> {
    const idx = await this.index();
    const prefix = q.projectId ? prefixOf(q.projectId) : null;
    const needle = q.query?.trim().toLowerCase();
    return idx.hexes
      .filter((h) => !h.kind.startsWith("studio."))
      .filter((h) => !prefix || prefixOf(h.id) === prefix)
      .filter((h) => !q.kind || h.kind === q.kind)
      .filter((h) => !q.status || h.status === q.status)
      .filter((h) => !needle || h.id.includes(needle) || h.title.toLowerCase().includes(needle))
      .sort(byCreated)
      .slice(0, q.limit ?? 50)
      .map(summarize);
  }

  async ready(projectId?: string): Promise<Hex[]> {
    const idx = await this.index();
    if (projectId) {
      const project = this.require(idx, projectId);
      if (project.kind !== "core.project") {
        throw new DomainError(`${projectId} is not a project`, 400);
      }
    }
    return readyHexes(idx, projectId ? prefixOf(projectId) ?? undefined : undefined);
  }

  async dependents(id: string): Promise<Hex[]> {
    const idx = await this.index();
    this.require(idx, id);
    return dependentsOf(idx, id);
  }

  async dependencies(id: string): Promise<Hex[]> {
    const idx = await this.index();
    return dependenciesOf(idx, this.require(idx, id));
  }

  // ── writing hexes ────────────────────────────────────────────────────────

  async createHex(req: CreateHexRequest): Promise<Hex> {
    const prefix = prefixOf(req.projectId);
    if (!prefix) throw new DomainError(`${req.projectId} is not a valid hex id`, 400);
    if (req.kind === "core.project") {
      throw new DomainError("Projects are created with create_project / the welcome screen", 400);
    }
    if (req.kind === "core.pull_request") {
      throw new DomainError("Pull requests are created by opening one on a work hex", 422);
    }
    return await this.mutate(async (hexes) => {
      const idx = buildIndex(hexes);
      if (!findProject(idx, prefix) && prefix !== SELECTED_PROJECT_PREFIX) {
        throw new DomainError(`No project with id prefix "${prefix}"`, 404);
      }
      const dependsOn = unique(req.dependsOn);
      const requiredBy = unique(req.requiredBy);
      for (
        const ref of [...dependsOn, ...requiredBy, ...(req.emergedFrom ? [req.emergedFrom] : [])]
      ) {
        this.require(idx, ref);
      }
      assertAllowed(req.kind, req.status);
      if (REQUIRES_RESPONSE.includes(req.status)) {
        throw new DomainError(`Create it first, then set ${req.status} with a response`, 422);
      }
      if (
        roleOf(req.status) === "actionable" &&
        !dependsOn.every((d) => {
          const dep = idx.byId.get(d);
          return dep !== undefined && satisfies(dep.status);
        })
      ) {
        throw notReady(req.status);
      }
      const t = this.now();
      const hex = await this.newHex(hexes, {
        prefix,
        kind: req.kind,
        title: req.title,
        description: req.description,
        status: req.status,
        createdAt: t,
        dependsOn,
        emergedFrom: req.emergedFrom,
        meta: req.meta,
      });
      for (const id of requiredBy) {
        const target = hexes.find((h) => h.id === id);
        if (target) {
          target.dependsOn = unique([...(target.dependsOn ?? []), hex.id]);
          target.lastUpdatedAtTimeInMs = t;
        }
      }
      reconcileReadiness(hexes, requiredBy, t);
      assertAcyclic(hexes);
      return hex;
    });
  }

  updateHex(id: string, patch: UpdateHexRequest): Promise<Hex> {
    return this.mutate(async (hexes) => {
      const hex = this.require(buildIndex(hexes), id);
      if (
        patch.expectedUpdatedAtTimeInMs !== undefined &&
        patch.expectedUpdatedAtTimeInMs !== hex.lastUpdatedAtTimeInMs
      ) {
        throw new DomainError("This hex was changed elsewhere. Reload it and try again.", 409);
      }
      const t = this.now();
      const changing = patch.status !== undefined && patch.status !== hex.status;
      const response = patch.response?.trim();
      if (
        patch.response !== undefined && !(changing && REQUIRES_RESPONSE.includes(patch.status!))
      ) {
        throw new DomainError(
          hex.status === "answered"
            ? "This question is already answered. Edit its decision hex instead."
            : "A response is only given when answering a question",
          400,
        );
      }
      if (patch.title !== undefined) hex.title = patch.title;
      if (patch.description !== undefined) hex.description = patch.description;
      if (changing) {
        const status = patch.status!;
        assertAllowed(hex.kind, status);
        if (roleOf(status) === "actionable" && !dependenciesDone(buildIndex(hexes), hex)) {
          throw notReady(status);
        }
        if (REQUIRES_RESPONSE.includes(status) && !response) {
          throw new DomainError("An answer needs a response", 422);
        }
        if (status === "answered" && hex.meta?.decision) {
          throw new DomainError(
            `This question was already answered by ${hex.meta.decision}. Edit that decision instead.`,
            409,
          );
        }
        const dependents = dependentsOf(buildIndex(hexes), id).map((d) => d.id);
        hex.status = status;
        if (status === "answered") await this.recordAnswer(hexes, hex, response!, t);
        reconcileReadiness(hexes, dependents, t);
      }
      hex.lastUpdatedAtTimeInMs = t;
      return hex;
    });
  }

  /** Deleting a project deletes every hex under its prefix. Returns the deleted ids. */
  deleteHex(id: string): Promise<string[]> {
    return this.mutate((hexes) => {
      const idx = buildIndex(hexes);
      const hex = this.require(idx, id);
      const prefix = prefixOf(id);
      const doomed = new Set(
        hex.kind === "core.project" && prefix ? projectHexes(idx, prefix).map((h) => h.id) : [id],
      );
      const survivors = hexes.filter((h) => !doomed.has(h.id));
      const touched: string[] = [];
      const t = this.now();
      for (const h of survivors) {
        const deps = h.dependsOn?.filter((d) => !doomed.has(d));
        const hadRef = (h.dependsOn?.length ?? 0) !== (deps?.length ?? 0);
        if (hadRef) {
          if (deps?.length) h.dependsOn = deps;
          else delete h.dependsOn;
          touched.push(h.id);
        }
        if (h.emergedFrom && doomed.has(h.emergedFrom)) {
          delete h.emergedFrom;
          touched.push(h.id);
        }
        if (h.kind === SELECTED_PROJECT_KIND && doomed.has(h.description)) {
          h.description = "";
          touched.push(h.id);
        }
      }
      hexes.splice(0, hexes.length, ...survivors);
      reconcileReadiness(hexes, touched, t);
      for (const h of hexes) if (touched.includes(h.id)) h.lastUpdatedAtTimeInMs = t;
      return [...doomed];
    });
  }

  setMeta(id: string, key: string, value: string, mode: MetaMode = "set"): Promise<Hex> {
    const k = key.trim();
    if (!k) throw new DomainError("meta key is required", 400);
    return this.mutate((hexes) => {
      const hex = this.require(buildIndex(hexes), id);
      const exists = hex.meta !== undefined && k in hex.meta;
      if (mode === "add" && exists) {
        throw new DomainError(`Meta key "${k}" already exists on ${id}; use update`, 409);
      }
      if (mode === "update" && !exists) {
        throw new DomainError(`Meta key "${k}" does not exist on ${id}; use add`, 404);
      }
      hex.meta = { ...hex.meta, [k]: value };
      hex.lastUpdatedAtTimeInMs = this.now();
      return hex;
    });
  }

  removeMeta(id: string, key: string): Promise<Hex> {
    return this.mutate((hexes) => {
      const hex = this.require(buildIndex(hexes), id);
      if (!hex.meta || !(key in hex.meta)) {
        throw new DomainError(`Meta key "${key}" does not exist on ${id}`, 404);
      }
      const { [key]: _removed, ...rest } = hex.meta;
      if (Object.keys(rest).length) hex.meta = rest;
      else delete hex.meta;
      hex.lastUpdatedAtTimeInMs = this.now();
      return hex;
    });
  }

  addDependency(id: string, dependsOnId: string): Promise<Hex> {
    return this.mutate((hexes) => {
      const idx = buildIndex(hexes);
      const hex = this.require(idx, id);
      this.require(idx, dependsOnId);
      hex.dependsOn = unique([...(hex.dependsOn ?? []), dependsOnId]);
      assertAcyclic(hexes);
      const t = this.now();
      reconcileReadiness(hexes, [id], t);
      hex.lastUpdatedAtTimeInMs = t;
      return hex;
    });
  }

  removeDependency(id: string, dependsOnId: string): Promise<Hex> {
    return this.mutate((hexes) => {
      const hex = this.require(buildIndex(hexes), id);
      if (!hex.dependsOn?.includes(dependsOnId)) {
        throw new DomainError(`${id} does not depend on ${dependsOnId}`, 404);
      }
      const rest = hex.dependsOn.filter((d) => d !== dependsOnId);
      if (rest.length) hex.dependsOn = rest;
      else delete hex.dependsOn;
      const t = this.now();
      reconcileReadiness(hexes, [id], t);
      hex.lastUpdatedAtTimeInMs = t;
      return hex;
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Stores the response on the question and turns it into a `done` decision: under the
   * question's design (else the project), emerged from the question, and depended on by
   * everything that depended on the question.
   */
  private async recordAnswer(hexes: Hex[], question: Hex, response: string, t: number) {
    const idx = buildIndex(hexes);
    const prefix = prefixOf(question.id)!;
    const designs = [
      ...dependenciesOf(idx, question),
      ...(question.emergedFrom ? [idx.byId.get(question.emergedFrom)] : []),
    ].filter((h): h is Hex => h?.kind === "core.design");
    const parent = designs[0] ?? findProject(idx, prefix);
    const decision = await this.newHex(hexes, {
      prefix,
      kind: "core.decision",
      title: `Decision: ${question.title}`,
      description: `${response}

---

Answers question ${question.id}: ${question.title}`,
      status: "done",
      createdAt: t,
      dependsOn: parent ? [parent.id] : [],
      emergedFrom: question.id,
    });
    for (const dependent of dependentsOf(idx, question.id)) {
      dependent.dependsOn = unique([...(dependent.dependsOn ?? []), decision.id]);
      dependent.lastUpdatedAtTimeInMs = t;
    }
    question.meta = {
      ...question.meta,
      answer: response,
      answered_at: new Date(t).toISOString(),
      decision: decision.id,
    };
  }

  /** Builds a hex with a fresh, collision-free id and appends it to `hexes`. */
  private async newHex(hexes: Hex[], o: {
    prefix: string;
    kind: string;
    title: string;
    description: string;
    status: Status;
    createdAt: number;
    dependsOn?: string[] | undefined;
    emergedFrom?: string | undefined;
    meta?: Record<string, string> | undefined;
  }): Promise<Hex> {
    const taken = new Set(hexes.map((h) => h.id));
    const id = await generateId(
      o.prefix,
      o.title,
      o.kind,
      o.createdAt,
      taken,
    );
    const hex: Hex = {
      id,
      title: o.title,
      description: o.description,
      kind: o.kind,
      createdAtTimeInMs: o.createdAt,
      lastUpdatedAtTimeInMs: o.createdAt,
      status: o.status,
    };
    if (o.dependsOn?.length) hex.dependsOn = o.dependsOn;
    if (o.emergedFrom) hex.emergedFrom = o.emergedFrom;
    if (o.meta && Object.keys(o.meta).length) hex.meta = o.meta;
    hexes.push(hex);
    return hex;
  }

  /** The singleton `studio.selected_project` hex holds the chosen project id as its value. */
  private async writeSelected(hexes: Hex[], projectId: string): Promise<void> {
    const t = this.now();
    const existing = hexes.find((h) => h.kind === SELECTED_PROJECT_KIND);
    if (existing) {
      if (existing.description === projectId) return;
      existing.description = projectId;
      existing.lastUpdatedAtTimeInMs = t;
      return;
    }
    await this.newHex(hexes, {
      prefix: SELECTED_PROJECT_PREFIX,
      kind: SELECTED_PROJECT_KIND,
      title: "Selected project",
      description: projectId,
      status: "done",
      createdAt: t,
    });
  }
}

function selectedProjectOf(idx: HexIndex): string | null {
  const sel = idx.hexes.find((h) => h.kind === SELECTED_PROJECT_KIND);
  const target = sel ? idx.byId.get(sel.description) : undefined;
  return target?.kind === "core.project" ? target.id : null;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** Refuses a status the hex's kind does not use, naming the ones it does. */
function assertAllowed(kind: string, status: Status): void {
  const allowed = allowedStatuses(kind);
  if (allowed.includes(status)) return;
  // Point at the kind's own word for the same thing, e.g. `blessed` for a design's `ready`.
  const instead = allowed.find((s) => roleOf(s) === roleOf(status));
  throw new DomainError(
    `A ${kind} cannot be ${status}${instead ? `; use ${instead}` : ""}. ` +
      `Its statuses are ${allowed.join(", ")}.`,
    422,
  );
}

function notReady(status: Status): DomainError {
  return new DomainError(`Cannot be ${status}: some dependencies are not done yet`, 409);
}

function assertAcyclic(hexes: readonly Hex[]): void {
  const cycle = findCycle(hexes);
  if (cycle) {
    throw new DomainError(`That would create a dependency cycle: ${cycle.join(" → ")}`, 409);
  }
}

/** The first sentence of a description as plain text: markdown is stripped, headings skipped. */
export function blurb(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const body = paragraphs.find((p) => !/^#{1,6}\s/.test(p)) ?? paragraphs[0] ?? "";
  const plain = body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-+*]|\d+\.)\s+/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]+|~~/g, "")
    .replace(/\b_+([^_]+)_+\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const first = plain.split(/(?<=[.!?])\s/)[0] ?? "";
  return first.length > 140 ? first.slice(0, 137).trimEnd() + "…" : first;
}

function initials(title: string): string {
  const words = title.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const letters = words.length > 1
    ? (words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")
    : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
