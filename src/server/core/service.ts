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
  isWorkKind,
  prefixOf,
  progressOf,
  projectHexes,
  projects,
  PULL_REQUEST_KIND,
  pullRequestsOf,
  readyHexes,
  reconcileReadiness,
  summarize,
} from "../../shared/graph.ts";
import {
  allowedStatuses,
  DERIVED,
  REQUIRES_RESPONSE,
  roleOf,
  satisfies,
} from "../../shared/constants.ts";
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
  ProjectGraph,
  ProjectSummary,
  ProjectView,
  PullRequestDiff,
  RecentProject,
  RecentWorkspace,
  WorkspaceState,
} from "../../shared/views.ts";
import { parseUnifiedDiff } from "../../shared/diff.ts";
import { DomainError } from "./errors.ts";
import { Git } from "./git.ts";
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
    const opened = await this.workspace.open(dir);
    const state = await this.state();
    if (state.selectedProjectId) {
      const project = buildIndex(await new HexFile(opened).read()).byId.get(
        state.selectedProjectId,
      );
      if (project) await this.recordRecent(opened, project);
    }
    return state;
  }

  /** Projects opened before, across folders, newest first, checked against what is on disk. */
  async recentProjects(): Promise<RecentProject[]> {
    const entries = await this.workspace.recentProjects();
    const { dir: openDir, selectedProjectId } = await this.state();
    const pinned = this.workspace.pinnedDir;
    const indexes = new Map<string, HexIndex | null>();
    const out: RecentProject[] = [];
    for (const e of entries) {
      if (!indexes.has(e.dir)) {
        indexes.set(e.dir, await new HexFile(e.dir).read().then(buildIndex, () => null));
      }
      const project = indexes.get(e.dir)?.byId.get(e.projectId);
      const found = project?.kind === "core.project";
      out.push({
        dir: e.dir,
        projectId: e.projectId,
        title: found ? project.title : e.title,
        folder: e.dir.split("/").filter(Boolean).pop() ?? e.dir,
        openedAt: e.openedAt,
        found,
        current: e.dir === openDir && e.projectId === selectedProjectId,
        switchable: pinned === null || pinned === e.dir,
      });
    }
    return out;
  }

  /**
   * Switches to a recent project in one step: opens its folder when it is not the open one, then
   * selects it. Checks the project exists first, so a stale entry leaves the open folder alone.
   */
  async openRecentProject(dir: string, projectId: string): Promise<WorkspaceState> {
    const target = resolveDir(dir);
    const pinned = this.workspace.pinnedDir;
    if (pinned && pinned !== target) {
      throw new DomainError(`The directory is pinned to ${pinned} by HEXES_DIR`, 409);
    }
    const project = await new HexFile(target).read().then(
      (hexes) => hexes.find((h) => h.id === projectId && h.kind === "core.project"),
      () => undefined,
    );
    if (!project) throw new DomainError(`${projectId} is no longer in ${target}`, 404);
    if (await this.workspace.current() !== target) await this.workspace.open(target);
    await this.selectProject(projectId);
    return await this.state();
  }

  /** Drops a project from the recent list. */
  async forgetRecentProject(dir: string, projectId: string): Promise<void> {
    await this.workspace.forgetProject(resolveDir(dir), projectId);
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
    await this.workspace.rememberProject({
      dir,
      projectId,
      title: req.title,
      openedAt: this.now(),
    });
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
    const file = await this.workspace.file();
    const project = await file.mutate(async (hexes) => {
      const project = hexes.find((h) => h.id === id && h.kind === "core.project");
      if (!project) throw new DomainError(`No project with id ${id}`, 404);
      await this.writeSelected(hexes, id);
      return project;
    });
    await this.recordRecent(file.dir, project);
  }

  /** Puts a project at the front of the per-user recent list, for switching back later. */
  private async recordRecent(dir: string, project: Hex): Promise<void> {
    await this.workspace.rememberProject({
      dir,
      projectId: project.id,
      title: project.title,
      openedAt: this.now(),
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
      specs: own.filter((h) => h.kind === "core.spec").map(summarize),
      decisions: own.filter((h) => h.kind === "core.decision").map(summarize),
      questions: own.filter((h) => h.kind === "core.question").map(summarize),
      epics,
    };
  }

  /** Every hex in a project and the links between them, for the hex map. */
  async projectGraph(id: string): Promise<ProjectGraph> {
    const idx = await this.index();
    const project = idx.byId.get(id);
    if (!project) throw new DomainError(`No project with id ${id}`, 404);
    if (project.kind !== "core.project") throw new DomainError(`${id} is not a project`, 422);
    const nodes = projectHexes(idx, prefixOf(id) ?? "")
      .filter((h) => h.id !== id && !h.kind.startsWith("studio."))
      .sort(byCreated);
    nodes.unshift(project);
    const ids = new Set(nodes.map((h) => h.id));
    return {
      projectId: id,
      nodes: nodes.map((h) => ({
        id: h.id,
        title: h.title,
        kind: h.kind,
        status: h.status,
        blurb: blurb(h.description),
        gitBranch: h.meta?.git_branch ?? null,
        updatedAt: h.lastUpdatedAtTimeInMs,
      })),
      edges: nodes.flatMap((h) =>
        (h.dependsOn ?? []).filter((to) => ids.has(to)).map((to) => ({ from: h.id, to }))
      ),
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
      assertNotDerived(req.status);
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
        if (hex.kind === PULL_REQUEST_KIND) {
          throw new DomainError("A pull request changes status by being merged or closed", 409);
        }
        assertAllowed(hex.kind, status);
        assertNotDerived(status);
        if (status === "done" && hex.meta?.git_branch) {
          throw new DomainError(
            `Work on a branch finishes by merging its pull request (${hex.meta.git_branch})`,
            409,
          );
        }
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

  // ── branches & pull requests ─────────────────────────────────────────────

  /** Git for the open workspace, after the checks every branch operation needs. */
  private async git(): Promise<Git> {
    const git = new Git((await this.workspace.file()).dir);
    await git.assertRepo();
    await git.assertDataIgnored();
    return git;
  }

  private async mainBranchFor(git: Git, hex: Hex, idx: HexIndex): Promise<string> {
    const project = findProject(idx, prefixOf(hex.id) ?? "");
    return await git.mainBranch(project?.meta?.git_main_branch);
  }

  /**
   * Puts a work hex's work on its own branch off main and switches to it: `hx/<id>-<slug>`,
   * recorded as `meta.git_branch` with the commit it started from as `meta.base_sha`. Calling it
   * again switches back to that branch, recreating it if it was deleted.
   */
  async startWork(id: string): Promise<Hex> {
    const idx = await this.index();
    const hex = this.require(idx, id);
    if (!isWorkKind(hex.kind)) {
      throw new DomainError(`A ${hex.kind} is not worked on a branch`, 422);
    }
    if (roleOf(hex.status) === "terminal") {
      throw new DomainError(`${id} is already ${hex.status}`, 409);
    }
    const git = await this.git();
    return await git.serial(async () => {
      const main = await this.mainBranchFor(git, hex, idx);
      const branch = hex.meta?.git_branch ?? branchName(hex);
      let base = hex.meta?.base_sha;
      if (await git.branchExists(branch)) {
        if (await git.currentBranch() !== branch) {
          await git.assertClean();
          await git.run("switch", "-q", branch);
        }
        base ??= await git.mergeBase(main, branch);
      } else {
        await git.assertClean();
        base = await git.revParse(main);
        await git.run("switch", "-q", "-c", branch, main);
      }
      return await this.mutate((hexes) => {
        const h = this.require(buildIndex(hexes), id);
        h.meta = { ...h.meta, git_branch: branch, base_sha: base! };
        if (roleOf(h.status) !== "active") h.status = "in_progress";
        h.lastUpdatedAtTimeInMs = this.now();
        return h;
      });
    });
  }

  /**
   * Opens a pull request for a work hex's branch: a `core.pull_request` hex the work hex then
   * depends on, so the work cannot be done until it is merged. Does not switch branches.
   */
  async openPullRequest(
    workId: string,
    opts: { title?: string | undefined; description?: string | undefined } = {},
  ): Promise<Hex> {
    const idx = await this.index();
    const work = this.require(idx, workId);
    if (!isWorkKind(work.kind)) {
      throw new DomainError(`A ${work.kind} does not get pull requests`, 422);
    }
    if (roleOf(work.status) === "terminal") {
      throw new DomainError(`${workId} is already ${work.status}`, 409);
    }
    const branch = work.meta?.git_branch;
    if (!branch) throw new DomainError("Start work on a branch first", 409);
    const git = await this.git();
    return await git.serial(async () => {
      const main = await this.mainBranchFor(git, work, idx);
      if (!await git.branchExists(branch)) {
        throw new DomainError(`The branch ${branch} no longer exists. Start work again.`, 409);
      }
      if (await git.aheadOf(main, branch) === 0) {
        throw new DomainError(`${branch} has no commits that ${main} does not have yet`, 409);
      }
      const base = await git.mergeBase(main, branch);
      const head = await git.revParse(branch);
      return await this.mutate(async (hexes) => {
        const idx = buildIndex(hexes);
        const w = this.require(idx, workId);
        const open = pullRequestsOf(idx, workId).find((p) =>
          p.status === "pull_requested" && p.meta?.source_branch === branch
        );
        if (open) {
          throw new DomainError(`${branch} already has an open pull request: ${open.id}`, 409);
        }
        const t = this.now();
        const pr = await this.newHex(hexes, {
          prefix: prefixOf(workId)!,
          kind: PULL_REQUEST_KIND,
          title: opts.title?.trim() || `PR: ${w.title}`,
          description: opts.description ?? "",
          status: "pull_requested",
          createdAt: t,
          meta: {
            work_hex: workId,
            source_branch: branch,
            target_branch: main,
            base_sha: base,
            head_sha: head,
          },
        });
        w.dependsOn = unique([...(w.dependsOn ?? []), pr.id]);
        w.status = "in_review";
        w.lastUpdatedAtTimeInMs = t;
        reconcileReadiness(hexes, [workId], t);
        return pr;
      });
    });
  }

  /**
   * Merges a pull request into its target branch with a merge commit, in the working tree (the
   * target stays checked out). A conflict is aborted, the previous branch restored, and nothing
   * recorded. The diff is also saved to `.hx/diffs/<id>.patch` for when the commits are gone.
   */
  async mergePullRequest(id: string): Promise<Hex> {
    const idx = await this.index();
    const pr = this.requirePullRequest(idx, id);
    const work = pr.meta?.work_hex ? idx.byId.get(pr.meta.work_hex) : undefined;
    const branch = pr.meta?.source_branch ?? "";
    const target = pr.meta?.target_branch ?? "";
    const git = await this.git();
    return await git.serial(async () => {
      await git.assertClean();
      for (const b of [branch, target]) {
        if (!await git.branchExists(b)) {
          throw new DomainError(`The branch ${b} no longer exists`, 409);
        }
      }
      if (await git.aheadOf(target, branch) === 0) {
        throw new DomainError(`${target} already has everything on ${branch}`, 409);
      }
      const previous = await git.currentBranch();
      if (previous !== target) await git.run("switch", "-q", target);
      const label = work ? `${work.title} (${work.id})` : id;
      const merge = await git.try(
        "merge",
        "--no-ff",
        "--no-edit",
        "-m",
        `Merge ${branch}: ${label}`,
        branch,
      );
      if (!merge.ok) {
        const conflicts = (await git.try("diff", "--name-only", "--diff-filter=U")).stdout;
        await git.try("merge", "--abort");
        if (previous && previous !== target) await git.try("switch", "-q", previous);
        throw new DomainError(
          conflicts
            ? `Merging ${branch} into ${target} conflicts in ${
              conflicts.split("\n").join(", ")
            }. ` +
              `Merge ${target} into ${branch}, resolve and commit, then merge again.`
            : `git merge failed: ${merge.stderr || merge.stdout}`,
          409,
        );
      }
      const mergeSha = await git.revParse("HEAD");
      const head = await git.revParse(branch);
      const patch = await git.run(
        "diff",
        "--no-color",
        "--no-ext-diff",
        "-M",
        `${mergeSha}^1`,
        mergeSha,
      );
      const diffs = `${git.dir}/.hx/diffs`;
      await Deno.mkdir(diffs, { recursive: true });
      await Deno.writeTextFile(`${diffs}/${id}.patch`, patch + "\n");
      return await this.mutate((hexes) => {
        const p = this.require(buildIndex(hexes), id);
        const t = this.now();
        p.status = "merged";
        p.meta = {
          ...p.meta,
          head_sha: head,
          merge_sha: mergeSha,
          merged_at: new Date(t).toISOString(),
        };
        p.lastUpdatedAtTimeInMs = t;
        // The work is on main: it is finished, and what waits on it can start.
        const idx = buildIndex(hexes);
        const w = p.meta.work_hex ? idx.byId.get(p.meta.work_hex) : undefined;
        if (w && roleOf(w.status) !== "terminal") {
          w.status = "merged";
          w.lastUpdatedAtTimeInMs = t;
        }
        const waiting = [id, ...(w ? [w.id] : [])].flatMap((d) => dependentsOf(idx, d));
        reconcileReadiness(hexes, waiting.map((d) => d.id), t);
        return p;
      });
    });
  }

  /** Abandons a pull request: it is kept as a record, and its work hex no longer waits on it. */
  closePullRequest(id: string): Promise<Hex> {
    return this.mutate((hexes) => {
      const idx = buildIndex(hexes);
      const pr = this.requirePullRequest(idx, id);
      const t = this.now();
      pr.status = "closed";
      pr.meta = { ...pr.meta, closed_at: new Date(t).toISOString() };
      pr.lastUpdatedAtTimeInMs = t;
      const work = pr.meta.work_hex ? idx.byId.get(pr.meta.work_hex) : undefined;
      const stillOpen = work &&
        pullRequestsOf(idx, work.id).some((p) => p.id !== id && p.status === "pull_requested");
      if (work?.status === "in_review" && !stillOpen) {
        work.status = "in_progress";
        work.lastUpdatedAtTimeInMs = t;
      }
      if (work?.dependsOn?.includes(id)) {
        const rest = work.dependsOn.filter((d) => d !== id);
        if (rest.length) work.dependsOn = rest;
        else delete work.dependsOn;
        work.lastUpdatedAtTimeInMs = t;
        reconcileReadiness(hexes, [work.id], t);
      }
      return pr;
    });
  }

  /**
   * What a pull request changes. Merged: the merge commit against main before it. Open or closed:
   * the branch since it left main. From the saved patch when the commits are gone.
   */
  async pullRequestDiff(id: string): Promise<PullRequestDiff> {
    const idx = await this.index();
    const pr = this.require(idx, id);
    if (pr.kind !== PULL_REQUEST_KIND) throw new DomainError(`${id} is not a pull request`, 422);
    const m = pr.meta ?? {};
    const dir = (await this.workspace.file()).dir;
    const git = new Git(dir);
    let text: string | null = null;
    let source: PullRequestDiff["source"] = "git";
    const range = pr.status === "merged" && m.merge_sha
      ? [`${m.merge_sha}^1`, m.merge_sha]
      : m.source_branch && await git.branchExists(m.source_branch).catch(() => false)
      ? [`${m.target_branch}...${m.source_branch}`]
      : m.base_sha && m.head_sha
      ? [m.base_sha, m.head_sha]
      : null;
    if (range) {
      const r = await git.try("diff", "--no-color", "--no-ext-diff", "-M", ...range).catch(() =>
        null
      );
      if (r?.ok) text = r.stdout;
    }
    if (text === null) {
      try {
        text = await Deno.readTextFile(`${dir}/.hx/diffs/${id}.patch`);
        source = "snapshot";
      } catch {
        throw new DomainError("This pull request's commits are gone and no saved diff exists", 404);
      }
    }
    const files = parseUnifiedDiff(text);
    const truncated = text.length > MAX_DIFF_CHARS;
    if (truncated) { for (const f of files) f.hunks = []; }
    return { files, truncated, source };
  }

  private requirePullRequest(idx: HexIndex, id: string): Hex {
    const pr = this.require(idx, id);
    if (pr.kind !== PULL_REQUEST_KIND) throw new DomainError(`${id} is not a pull request`, 422);
    if (pr.status !== "pull_requested") throw new DomainError(`${id} is already ${pr.status}`, 409);
    return pr;
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

/** Past this, a diff is listed by file only. */
const MAX_DIFF_CHARS = 1_000_000;

/** `hx/<id>-<slug>`, the slug from the title: lowercase words joined by dashes, at most 40 chars. */
export function branchName(hex: Hex): string {
  const slug = hex.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 40).replace(/-+$/, "");
  return slug ? `hx/${hex.id}-${slug}` : `hx/${hex.id}`;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** Refuses a status the hex's kind does not use, naming the ones it does. */
/** `in_review` and `merged` follow a hex's pull requests; nobody sets them by hand. */
function assertNotDerived(status: Status): void {
  if (!DERIVED.includes(status)) return;
  throw new DomainError(
    status === "in_review"
      ? "in_review is set by opening a pull request"
      : "merged is set by merging its pull request",
    409,
  );
}

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
