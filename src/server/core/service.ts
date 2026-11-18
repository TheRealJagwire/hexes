import {
  ARCHIVED_KEY,
  AUTO_MERGE_KEY,
  autoMergeOn,
  breadcrumbs,
  buildIndex,
  byCreated,
  canArchiveEpic,
  dependenciesDone,
  dependenciesOf,
  dependentsOf,
  epicStories,
  FACT_KIND,
  findCycle,
  findProject,
  gateProgress,
  hasRepository,
  type HexIndex,
  IDEA_KIND,
  isWorkKind,
  prefixOf,
  progressOf,
  projectHexes,
  projects,
  PULL_REQUEST_KIND,
  pullRequestsOf,
  readyHexes,
  reconcileReadiness,
  repoPathOf,
  seedWarnings,
  sortEpics,
  sortGates,
  summarize,
} from "../../shared/graph.ts";
import {
  allowedStatuses,
  DERIVED,
  REPO_PATH_KEY,
  REPO_REF_KEY,
  REQUIRES_RESPONSE,
  roleOf,
  satisfies,
  SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  SEED_BRANCH_KEY,
  SEED_GIT_URL_KEY,
  SEED_KIND,
  SEED_PREFIX,
  waitsOnDependencies,
} from "../../shared/constants.ts";
import {
  type CreateHexRequest,
  type CreateProjectRequest,
  type CreateSeedRequest,
  type Hex,
  SELECTED_PROJECT_KIND,
  SELECTED_PROJECT_PREFIX,
  type Status,
  type UpdateHexRequest,
  type UpdateSeedRequest,
} from "../../shared/schemas.ts";
import type {
  CreateProjectResult,
  EpicView,
  FactHit,
  FactsQuery,
  FactsResult,
  GateView,
  GraphNode,
  HexSummary,
  HexView,
  InspectResult,
  ProjectGraph,
  ProjectSummary,
  ProjectView,
  PullRequestDiff,
  RecentProject,
  RecentWorkspace,
  SeedView,
  WorkspaceState,
} from "../../shared/views.ts";
import { parseUnifiedDiff } from "../../shared/diff.ts";
import { factsNear } from "../../shared/facts.ts";
import { searchHexes } from "../../shared/search.ts";
import { DomainError } from "./errors.ts";
import { Git } from "./git.ts";
import { derivePrefix, generateId } from "./ids.ts";
import { ensureMigrated } from "./migrate.ts";
import { type MigrateResult, migrateToV2 } from "./migrate_v2.ts";
import { HexFile, ProjectFile } from "./store.ts";
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
    const base = {
      pinned: this.workspace.pinnedDir !== null,
      lastDir: await this.workspace.lastDir(),
    };
    const v2 = await this.workspace.selectedV2();
    if (v2) {
      const file = await this.workspace.projectFile(v2);
      const repoPath = repoPathOf(buildIndex(await file.read()).byId.get(v2));
      return {
        ...base,
        dir: repoPath,
        selectedProjectId: v2,
        schemaVersion: 2,
        repoPath,
        dataPath: file.path,
      };
    }
    const dir = await this.workspace.current();
    let selectedProjectId: string | null = null;
    if (dir) selectedProjectId = selectedProjectOf(buildIndex(await new HexFile(dir).read()));
    return {
      ...base,
      dir,
      selectedProjectId,
      schemaVersion: 1,
      repoPath: dir,
      dataPath: dir ? new HexFile(dir).path : null,
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
    const { dir: openDir, selectedProjectId, schemaVersion } = await this.state();
    const pinned = this.workspace.pinnedDir;
    const indexes = new Map<string, HexIndex | null>();
    const out: RecentProject[] = [];
    for (const e of entries) {
      if (e.dir === undefined) {
        const file = this.workspace.projects.file(e.projectId);
        const project = pinned
          ? undefined
          : (await file.read().then(buildIndex, () => null))?.byId.get(e.projectId);
        const found = project?.kind === "core.project";
        const repo = found ? repoPathOf(project) ?? "" : "";
        out.push({
          dir: repo,
          projectId: e.projectId,
          title: found ? project.title : e.title,
          folder: repo.split("/").filter(Boolean).pop() ?? e.projectId,
          openedAt: e.openedAt,
          found,
          current: schemaVersion === 2 && e.projectId === selectedProjectId,
          switchable: pinned === null,
          needsMigration: false,
        });
        continue;
      }
      const dir = e.dir;
      if (!indexes.has(dir)) {
        indexes.set(dir, await new HexFile(dir).read().then(buildIndex, () => null));
      }
      const project = indexes.get(dir)?.byId.get(e.projectId);
      const found = project?.kind === "core.project";
      out.push({
        dir,
        projectId: e.projectId,
        title: found ? project.title : e.title,
        folder: dir.split("/").filter(Boolean).pop() ?? dir,
        openedAt: e.openedAt,
        found,
        current: schemaVersion === 1 && dir === openDir && e.projectId === selectedProjectId,
        switchable: pinned === null || pinned === dir,
        needsMigration: true,
      });
    }
    return out;
  }

  /**
   * Switches to a recent project in one step. A v2 project is selected by id; for a v1 one, its
   * folder is opened when it is not the open one, then it is selected. Checks the project exists
   * first, so a stale entry leaves the open folder alone.
   */
  async openRecentProject(dir: string, projectId: string): Promise<WorkspaceState> {
    if (await this.workspace.hasProject(projectId)) {
      await this.selectProject(projectId);
      return await this.state();
    }
    if (!dir.trim()) throw new DomainError(`No project with id ${projectId}`, 404);
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
    await this.selectV1(target, projectId);
    return await this.state();
  }

  /**
   * Moves a v1 folder's projects to ~/.hx/projects (schema v2), all or nothing. A person's
   * action, offered by Studio; agents get no tool for it.
   */
  migrateProject(dir: string): Promise<MigrateResult> {
    return migrateToV2(resolveDir(dir), this.workspace.projects, this.workspace, { now: this.now });
  }

  /** Drops a project from the recent list. An empty `dir` means a v2 project. */
  async forgetRecentProject(dir: string, projectId: string): Promise<void> {
    await this.workspace.forgetProject(dir.trim() ? resolveDir(dir) : undefined, projectId);
  }

  /**
   * Creates a schema-v2 project: `~/.hx/projects/<id>/data.json` holding only the project hex,
   * with `repo_path` set to `dir` (git-initialised on request). Nothing is written under
   * `dir/.hx`. The new project is selected.
   */
  async createProject(req: CreateProjectRequest): Promise<CreateProjectResult> {
    if (this.workspace.pinnedDir) {
      throw new DomainError(
        `The directory is pinned to ${this.workspace.pinnedDir} by HEXES_DIR`,
        409,
      );
    }
    // No folder: the project starts without a repository and gets one later.
    const dir = req.dir.trim() ? resolveDir(req.dir) : null;
    if (dir && await new HexFile(dir).exists()) {
      throw new DomainError(`${dir} already has a .hx/data.json. Open it instead.`, 409);
    }
    const store = this.workspace.projects;
    // Reserved prefixes stay off projects: seeds and Studio's own hexes use them.
    const prefixes = new Set<string>([SEED_PREFIX, SELECTED_PROJECT_PREFIX]);
    for (const id of await store.list()) {
      const prefix = prefixOf(id);
      if (prefix) prefixes.add(prefix);
    }
    if (dir) {
      await this.assertRepoFree(dir, null);
      try {
        await Deno.mkdir(dir, { recursive: true });
      } catch (e) {
        throw new DomainError(`Cannot create ${dir}: ${e instanceof Error ? e.message : e}`, 400);
      }
    }
    const t = this.now();
    const hexes: Hex[] = [];
    const project = await this.newHex(hexes, {
      prefix: derivePrefix(req.title, prefixes),
      kind: "core.project",
      title: req.title,
      description: req.description,
      // A stated vision is a finished artifact; designs and the rest hang off it.
      status: "done",
      createdAt: t,
      meta: { [SCHEMA_VERSION_KEY]: SCHEMA_VERSION, ...(dir ? { [REPO_PATH_KEY]: dir } : {}) },
    });
    await store.file(project.id).mutate((list) => {
      list.push(...hexes);
    }, { create: true });
    const warnings: string[] = [];
    if (dir && req.gitInit) {
      const warning = await gitInit(dir);
      if (warning) warnings.push(warning);
    }
    await this.workspace.selectV2(project.id);
    await this.recordRecent(undefined, project);
    return { projectId: project.id, warnings };
  }

  // ── repository seeds ─────────────────────────────────────────────────────
  // Shared by every project, in ~/.hx/seeds/data.json: never in a project's file.

  /** Available seeds, oldest first; retired ones too with `includeRetired`. */
  async listSeeds(opts: { includeRetired?: boolean | undefined } = {}): Promise<SeedView[]> {
    const file = this.workspace.projects.seeds();
    const hexes = await file.exists() ? await file.read() : [];
    return hexes
      .filter((h) => h.kind === SEED_KIND && (opts.includeRetired || h.status === "available"))
      .sort(byCreated)
      .map(seedView);
  }

  async createSeed(req: CreateSeedRequest): Promise<SeedView> {
    const gitUrl = req.gitUrl.trim();
    if (!gitUrl) throw new DomainError("A seed needs a git URL", 400);
    const t = this.now();
    const seed = await this.workspace.projects.seeds().mutate((hexes) =>
      this.newHex(hexes, {
        prefix: SEED_PREFIX,
        kind: SEED_KIND,
        title: req.title,
        description: req.description,
        status: "available",
        createdAt: t,
        meta: { [SEED_GIT_URL_KEY]: gitUrl, [SEED_BRANCH_KEY]: req.branch?.trim() || "main" },
      }), { create: true });
    return seedView(seed);
  }

  async updateSeed(id: string, patch: UpdateSeedRequest): Promise<SeedView> {
    return seedView(
      await this.mutateSeed(id, (seed) => {
        if (patch.title !== undefined) seed.title = patch.title;
        if (patch.description !== undefined) seed.description = patch.description;
        const meta = { ...seed.meta };
        if (patch.gitUrl !== undefined) meta[SEED_GIT_URL_KEY] = patch.gitUrl;
        if (patch.branch !== undefined) meta[SEED_BRANCH_KEY] = patch.branch;
        seed.meta = meta;
      }),
    );
  }

  /** Stops offering a seed; `restore` offers it again. */
  async retireSeed(id: string, restore = false): Promise<SeedView> {
    return seedView(
      await this.mutateSeed(id, (seed) => {
        seed.status = restore ? "available" : "retired";
      }),
    );
  }

  private mutateSeed(id: string, fn: (seed: Hex) => void): Promise<Hex> {
    return this.workspace.projects.seeds().mutate((hexes) => {
      const seed = hexes.find((h) => h.id === id && h.kind === SEED_KIND);
      if (!seed) throw new DomainError(`No seed with id ${id}`, 404);
      const before = JSON.stringify(seed);
      fn(seed);
      if (JSON.stringify(seed) !== before) seed.lastUpdatedAtTimeInMs = this.now();
      return seed;
    }, { create: true });
  }

  /** Refuses `dir` when it is already another project's repository. */
  private async assertRepoFree(dir: string, except: string | null): Promise<void> {
    const store = this.workspace.projects;
    for (const id of await store.list()) {
      if (id === except) continue;
      const project = (await store.file(id).read().catch(() => [])).find((h) => h.id === id);
      if (repoPathOf(project) === dir) {
        throw new DomainError(`${dir} is already the repo of project ${id}. Open it instead.`, 409);
      }
    }
  }

  /**
   * Gives a v2 project its repository: with `seedId`, clones that seed into `dir` (which must be
   * missing or empty), renames its `origin` remote to `seed` and records `repo_ref_hx`; without,
   * uses `dir`, which must already be a git working tree. Either way sets `repo_path`.
   */
  async setProjectRepo(
    projectId: string,
    req: { dir: string; seedId?: string | undefined },
  ): Promise<Hex> {
    if (!await this.workspace.hasProject(projectId)) {
      throw new DomainError(
        `${projectId} is not in ~/.hx/projects; migrate it first (or check the id)`,
        409,
      );
    }
    const dir = resolveDir(req.dir);
    await this.assertRepoFree(dir, projectId);
    let seedId: string | null = null;
    if (req.seedId) {
      const seed = (await this.listSeeds({ includeRetired: true })).find((s) =>
        s.hex.id === req.seedId
      );
      if (!seed) throw new DomainError(`No seed with id ${req.seedId}`, 404);
      if (seed.hex.status !== "available") {
        throw new DomainError(`Seed ${req.seedId} is retired`, 409);
      }
      await this.forkSeed(seed, dir);
      seedId = seed.hex.id;
    } else {
      const isDir = await Deno.stat(dir).then((s) => s.isDirectory, () => false);
      const tree = isDir && (await new Git(dir).try("rev-parse", "--is-inside-work-tree"))
            .stdout === "true";
      if (!tree) throw new DomainError(`${dir} is not a git working tree`, 422);
    }
    return await this.workspace.projects.file(projectId).mutate((hexes) => {
      const project = hexes.find((h) => h.id === projectId && h.kind === "core.project");
      if (!project) throw new DomainError(`No project with id ${projectId}`, 404);
      const meta: Record<string, string> = { ...project.meta, [REPO_PATH_KEY]: dir };
      if (seedId) meta[REPO_REF_KEY] = seedId;
      else delete meta[REPO_REF_KEY];
      project.meta = meta;
      project.lastUpdatedAtTimeInMs = this.now();
      return project;
    });
  }

  /** Clones a seed into `dir` and renames `origin` to `seed`; on failure leaves nothing behind. */
  private async forkSeed(seed: SeedView, dir: string): Promise<void> {
    let existed = false;
    try {
      existed = (await Deno.stat(dir)).isDirectory;
      for await (const _ of Deno.readDir(dir)) {
        throw new DomainError(`${dir} is not empty; fork into a new or empty folder`, 409);
      }
    } catch (e) {
      if (e instanceof DomainError) throw e;
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    const parent = dir.replace(/\/[^/]*$/, "") || "/";
    await Deno.mkdir(parent, { recursive: true });
    const clone = await new Git(parent).try(
      "clone",
      "--branch",
      seed.branch,
      seed.gitUrl,
      dir,
    );
    const renamed = clone.ok && (await new Git(dir).try("remote", "rename", "origin", "seed")).ok;
    if (!renamed) {
      if (existed) {
        try {
          for await (const e of Deno.readDir(dir)) {
            await Deno.remove(`${dir}/${e.name}`, { recursive: true }).catch(() => {});
          }
        } catch { /* already gone */ }
      } else {
        await Deno.remove(dir, { recursive: true }).catch(() => {});
      }
      throw new DomainError(
        `Could not fork ${seed.hex.id}: ${clone.ok ? "renaming its remote failed" : clone.stderr}`,
        422,
      );
    }
  }

  // ── projects ─────────────────────────────────────────────────────────────

  /** The hexes of the data file holding `scope`, a hex or project id (found by its prefix). */
  private async index(scope: string): Promise<HexIndex> {
    return buildIndex(await (await this.workspace.fileFor(scope)).read());
  }

  /** Changes the data file holding `scope`, a hex or project id (found by its prefix). */
  private async mutate<T>(scope: string, fn: (hexes: Hex[]) => T | Promise<T>): Promise<T> {
    return (await this.workspace.fileFor(scope)).mutate(fn);
  }

  /**
   * One index per data file worth searching when no project is named: every v2 project, then
   * the open v1 folder (if any).
   */
  private async indexes(): Promise<HexIndex[]> {
    const out: HexIndex[] = [];
    if (!this.workspace.pinnedDir) {
      for (const id of await this.workspace.projects.list()) {
        const file = await this.workspace.projectFile(id);
        await ensureMigrated(file);
        out.push(buildIndex(await file.read()));
      }
    }
    const dir = await this.workspace.current();
    if (dir) {
      const file = new HexFile(dir);
      await ensureMigrated(file);
      out.push(buildIndex(await file.read()));
    }
    return out;
  }

  /**
   * Every project: those in ~/.hx/projects, then those still in v1 folders (the open one and
   * recent ones), which need migrating. A v1 copy of a project already moved is left out.
   */
  async listProjects(): Promise<ProjectSummary[]> {
    const out: ProjectSummary[] = [];
    const seen = new Set<string>();
    const add = (idx: HexIndex, where: { v1Dir: string } | null) => {
      for (const p of projects(idx)) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const prefix = prefixOf(p.id);
        const own = prefix ? projectHexes(idx, prefix) : [];
        out.push({
          id: p.id,
          title: p.title,
          blurb: blurb(p.description),
          initial: initials(p.title),
          epics: own.filter((h) => h.kind === "core.epic").length,
          stories: own.filter((h) => h.kind === "core.story").length,
          needsMigration: where !== null,
          repoPath: where ? where.v1Dir : repoPathOf(p),
          dataPath: where
            ? new HexFile(where.v1Dir).path
            : this.workspace.projects.projectFile(p.id),
        });
      }
    };
    if (!this.workspace.pinnedDir) {
      for (const id of await this.workspace.projects.list()) {
        const idx = await this.workspace.projects.file(id).read().then(buildIndex, () => null);
        if (idx) add(idx, null);
      }
    }
    for (const dir of await this.v1Dirs()) {
      const idx = await new HexFile(dir).read().then(buildIndex, () => null);
      if (idx) add(idx, { v1Dir: dir });
    }
    return out;
  }

  /** v1 folders worth looking in: the open (or pinned) one first, then recent ones. */
  private async v1Dirs(): Promise<string[]> {
    const open = await this.workspace.current();
    if (this.workspace.pinnedDir) return open ? [open] : [];
    const dirs = [...(open ? [open] : []), ...await this.workspace.recent()];
    return [...new Set(dirs)];
  }

  async selectedProjectId(): Promise<string | null> {
    return (await this.state()).selectedProjectId;
  }

  /**
   * Selects a project: a v2 one by id in state.json; a v1 one in the open folder, or in a recent
   * folder, which is opened first.
   */
  async selectProject(id: string): Promise<void> {
    if (await this.workspace.hasProject(id)) {
      const file = await this.workspace.projectFile(id);
      const project = (await file.read()).find((h) => h.id === id && h.kind === "core.project");
      if (!project) throw new DomainError(`No project with id ${id}`, 404);
      await this.workspace.selectV2(id);
      await this.recordRecent(undefined, project);
      return;
    }
    for (const dir of await this.v1Dirs()) {
      const has = await new HexFile(dir).read().then(
        (hexes) => hexes.some((h) => h.id === id && h.kind === "core.project"),
        () => false,
      );
      if (!has) continue;
      if (await this.workspace.current() !== dir) await this.workspace.open(dir);
      await this.selectV1(dir, id);
      return;
    }
    throw new DomainError(`No project with id ${id}`, 404);
  }

  /** Selects a project in a v1 folder's `studio.selected_project` hex, leaving any v2 selection. */
  private async selectV1(dir: string, id: string): Promise<void> {
    const file = new HexFile(dir);
    await ensureMigrated(file);
    const project = await file.mutate(async (hexes) => {
      const project = hexes.find((h) => h.id === id && h.kind === "core.project");
      if (!project) throw new DomainError(`No project with id ${id}`, 404);
      await this.writeSelected(hexes, id);
      return project;
    });
    await this.workspace.remember(dir);
    await this.recordRecent(dir, project);
  }

  /** Puts a project at the front of the per-user recent list; `dir` only for a v1 project. */
  private async recordRecent(dir: string | undefined, project: Hex): Promise<void> {
    await this.workspace.rememberProject({
      ...(dir ? { dir } : {}),
      projectId: project.id,
      title: project.title,
      openedAt: this.now(),
    });
  }

  async projectView(id: string): Promise<ProjectView> {
    const idx = await this.index(id);
    const project = idx.byId.get(id);
    if (!project || project.kind !== "core.project") {
      throw new DomainError(`No project with id ${id}`, 404);
    }
    const own = projectHexes(idx, prefixOf(id) ?? "").sort(byCreated);
    const ownEpics = own.filter((h) => h.kind === "core.epic");
    const epics: EpicView[] = sortEpics(idx, ownEpics).map((epic) => {
      const gate = dependentsOf(idx, epic.id).find((d) => d.kind === "core.gate");
      const stories = epicStories(idx, epic);
      return {
        hex: epic,
        gate: gate ? summarize(gate) : null,
        progress: progressOf(stories),
        stories,
      };
    });
    const gates: GateView[] = sortGates(idx, own.filter((h) => h.kind === "core.gate")).map(
      (gate) => ({ hex: summarize(gate), epics: gateProgress(idx, gate) }),
    );
    return {
      project,
      gates,
      designs: own.filter((h) => h.kind === "core.design").map(summarize),
      specs: own.filter((h) => h.kind === "core.spec").map(summarize),
      decisions: own.filter((h) => h.kind === "core.decision").map(summarize),
      questions: own.filter((h) => h.kind === "core.question").map(summarize),
      ideas: own.filter((h) => h.kind === IDEA_KIND).reverse().map(summarize),
      facts: own.filter((h) => h.kind === FACT_KIND).reverse().map(summarize),
      epics,
      autoMerge: autoMergeOn(project),
      needsRepository: !hasRepository(project),
    };
  }

  /** Turns a project's auto-merge on or off (`meta.auto_merge`). A person's setting. */
  setAutoMerge(projectId: string, enabled: boolean): Promise<Hex> {
    return this.mutate(projectId, (hexes) => {
      const project = buildIndex(hexes).byId.get(projectId);
      if (!project || project.kind !== "core.project") {
        throw new DomainError(`No project with id ${projectId}`, 404);
      }
      project.meta = { ...project.meta, [AUTO_MERGE_KEY]: enabled ? "on" : "off" };
      project.lastUpdatedAtTimeInMs = this.now();
      return project;
    });
  }

  /**
   * Archives an epic (`meta.archived` = the time) once every story it depends on is finished, or
   * unarchives it. Unarchiving is always allowed.
   */
  setArchived(id: string, archived: boolean): Promise<Hex> {
    return this.mutate(id, (hexes) => {
      const idx = buildIndex(hexes);
      const epic = idx.byId.get(id);
      if (!epic) throw new DomainError(`No hex with id ${id}`, 404);
      if (epic.kind !== "core.epic") throw new DomainError("Only an epic can be archived.", 400);
      const meta = { ...epic.meta };
      if (archived) {
        if (!canArchiveEpic(epicStories(idx, epic))) {
          throw new DomainError("An epic can be archived once all its stories are closed.", 409);
        }
        meta[ARCHIVED_KEY] = new Date(this.now()).toISOString();
      } else {
        delete meta[ARCHIVED_KEY];
      }
      epic.meta = meta;
      epic.lastUpdatedAtTimeInMs = this.now();
      return epic;
    });
  }

  /** Every hex in a project and the links between them, for the hex map. */
  async projectGraph(id: string): Promise<ProjectGraph> {
    const idx = await this.index(id);
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
      nodes: nodes.map(graphNode),
      edges: nodes.flatMap((h) =>
        (h.dependsOn ?? []).filter((to) => ids.has(to)).map((to) => ({ from: h.id, to }))
      ),
    };
  }

  /**
   * The project's facts that pass every filter given: near a hex (by hops over links), about a
   * file (`meta.files`), matching a title search, and known unless retired ones are asked for.
   */
  async facts(projectId: string, q: FactsQuery = {}): Promise<FactsResult> {
    const idx = await this.index(projectId);
    const project = idx.byId.get(projectId);
    if (!project || project.kind !== "core.project") {
      throw new DomainError(`No project with id ${projectId}`, 404);
    }
    const prefix = prefixOf(projectId) ?? "";
    const depth = q.depth ?? 2;
    if (!Number.isInteger(depth) || depth < 1 || depth > 4) {
      throw new DomainError("depth must be a whole number from 1 to 4", 422);
    }
    let candidates = projectHexes(idx, prefix).filter((h) =>
      h.kind === FACT_KIND && (q.includeRetired || h.status === "known")
    );
    let near: Map<string, string[]> | null = null;
    if (q.near !== undefined) {
      if (!idx.byId.has(q.near) || prefixOf(q.near) !== prefix) {
        throw new DomainError(`No hex with id ${q.near} in this project`, 404);
      }
      near = factsNear(idx, q.near, depth);
      candidates = candidates.filter((h) => near!.has(h.id));
    }
    if (q.file !== undefined) {
      const file = normalisePath(q.file);
      candidates = candidates.filter((h) =>
        (h.meta?.files ?? "").split(",").some((f) => normalisePath(f) === file)
      );
    }
    if (q.query !== undefined && q.query.trim()) {
      const matched = new Set(
        searchHexes(candidates.map(graphNode), q.query, candidates.length).map((m) => m.node.id),
      );
      candidates = candidates.filter((h) => matched.has(h.id));
    }
    const hits: FactHit[] = candidates.map((fact) => {
      const path = near?.get(fact.id);
      return {
        fact,
        distance: path ? path.length - 1 : null,
        path: (path ?? []).map((id) => summarize(idx.byId.get(id)!)),
      };
    });
    hits.sort((a, b) =>
      (a.distance ?? 0) - (b.distance ?? 0) ||
      b.fact.lastUpdatedAtTimeInMs - a.fact.lastUpdatedAtTimeInMs ||
      (a.fact.id < b.fact.id ? -1 : a.fact.id > b.fact.id ? 1 : 0)
    );
    return { facts: hits };
  }

  // ── reading hexes ────────────────────────────────────────────────────────

  private require(idx: HexIndex, id: string): Hex {
    const hex = idx.byId.get(id);
    if (!hex) throw new DomainError(`No hex with id ${id}`, 404);
    return hex;
  }

  async getHex(id: string): Promise<Hex> {
    return this.require(await this.index(id), id);
  }

  async hexView(id: string): Promise<HexView> {
    const idx = await this.index(id);
    const hex = this.require(idx, id);
    const prefix = prefixOf(id);
    const emergedHere = idx.hexes.filter((h) => h.emergedFrom === id).sort(byCreated);
    const dependents = dependentsOf(idx, id);
    const emergedFromHex = hex.emergedFrom ? idx.byId.get(hex.emergedFrom) : undefined;
    const pullRequests = pullRequestsOf(idx, id);
    const workHex = hex.meta?.work_hex ? idx.byId.get(hex.meta.work_hex) : undefined;
    const project = prefix ? findProject(idx, prefix) : undefined;
    return {
      hex,
      breadcrumbs: breadcrumbs(idx, hex).map(summarize),
      projectId: project?.id ?? null,
      dependsOn: dependenciesOf(idx, hex).map(summarize),
      // Facts about this hex are listed apart, so they don't read as work waiting on it.
      dependedOnBy: dependents.filter((d) => d.kind !== FACT_KIND).map(summarize),
      emergedFromHex: emergedFromHex ? summarize(emergedFromHex) : null,
      emergedHere: emergedHere.map(summarize),
      workBranch: hex.meta?.git_branch ?? null,
      pullRequests: pullRequests.map((pr) => ({
        ...summarize(pr),
        sourceBranch: pr.meta?.source_branch ?? "",
        targetBranch: pr.meta?.target_branch ?? "",
        mergeSha: pr.meta?.merge_sha ?? null,
        conflicts: conflictsOf(pr),
      })),
      workHex: workHex ? summarize(workHex) : null,
      facts: dependents.filter((d) => d.kind === FACT_KIND).sort(byCreated).reverse().map(
        summarize,
      ),
      autoMerge: autoMergeOn(project),
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
    const idx = await this.index(id);
    return breadcrumbs(idx, this.require(idx, id)).map(summarize);
  }

  /** Hexes matching a query: in one project when `projectId` is given, else in every project. */
  async search(q: SearchQuery = {}): Promise<HexSummary[]> {
    const indexes = q.projectId ? [await this.index(q.projectId)] : await this.indexes();
    const prefix = q.projectId ? prefixOf(q.projectId) : null;
    const needle = q.query?.trim().toLowerCase();
    return uniqueById(indexes.flatMap((idx) => idx.hexes))
      .filter((h) => !h.kind.startsWith("studio."))
      .filter((h) => !prefix || prefixOf(h.id) === prefix)
      .filter((h) => !q.kind || h.kind === q.kind)
      .filter((h) => !q.status || h.status === q.status)
      .filter((h) => !needle || h.id.includes(needle) || h.title.toLowerCase().includes(needle))
      .sort(byCreated)
      .slice(0, q.limit ?? 50)
      .map(summarize);
  }

  /** Hexes that can be picked up: in one project when `projectId` is given, else in all of them. */
  async ready(projectId?: string): Promise<Hex[]> {
    if (projectId) {
      const idx = await this.index(projectId);
      const project = this.require(idx, projectId);
      if (project.kind !== "core.project") {
        throw new DomainError(`${projectId} is not a project`, 400);
      }
      return readyHexes(idx, prefixOf(projectId) ?? undefined);
    }
    return uniqueById((await this.indexes()).flatMap((idx) => readyHexes(idx)));
  }

  async dependents(id: string): Promise<Hex[]> {
    const idx = await this.index(id);
    this.require(idx, id);
    return dependentsOf(idx, id);
  }

  async dependencies(id: string): Promise<Hex[]> {
    const idx = await this.index(id);
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
    return await this.mutate(req.projectId, async (hexes) => {
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
      if (req.kind === IDEA_KIND && req.status !== "draft") {
        throw new DomainError("An idea starts as a draft", 422);
      }
      if (req.kind === FACT_KIND && req.status !== "known") {
        throw new DomainError("A fact starts as known", 422);
      }
      if (REQUIRES_RESPONSE.includes(req.status)) {
        throw new DomainError(`Create it first, then set ${req.status} with a response`, 422);
      }
      if (
        roleOf(req.status) === "actionable" && waitsOnDependencies(req.kind) &&
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
    return this.mutate(id, async (hexes) => {
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
        if (
          roleOf(status) === "actionable" && waitsOnDependencies(hex.kind) &&
          !dependenciesDone(buildIndex(hexes), hex)
        ) {
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
    return this.mutate(id, (hexes) => {
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
    return this.mutate(id, (hexes) => {
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
    return this.mutate(id, (hexes) => {
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

  async addDependency(id: string, dependsOnId: string): Promise<Hex> {
    const [a, b] = await Promise.all([
      this.workspace.projectFor(id),
      this.workspace.projectFor(dependsOnId),
    ]);
    if (a !== b) {
      throw new DomainError(`${id} and ${dependsOnId} belong to different projects`, 422);
    }
    return await this.mutate(id, (hexes) => {
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
    return this.mutate(id, (hexes) => {
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

  /**
   * Where git runs and merged patches are kept for the project being worked on: a v2 project's
   * repo_path and `~/.hx/projects/<id>/diffs`; for v1, the folder holding `.hx/` and its
   * `.hx/diffs`.
   */
  private async repo(scope: string): Promise<{ dir: string; diffs: string; v2: boolean }> {
    const file = await this.workspace.fileFor(scope);
    if (file instanceof ProjectFile) {
      const project = (await file.read()).find((h) => h.id === file.projectId);
      const dir = repoPathOf(project);
      if (!dir) {
        throw new DomainError(
          "Set this project's repository first (fork a seed or pick a folder)",
          409,
        );
      }
      return { dir, diffs: `${file.folder}/diffs`, v2: true };
    }
    return { dir: file.dir, diffs: `${file.dir}/.hx/diffs`, v2: false };
  }

  /** Git for the open project, after the checks every branch operation needs. */
  private async git(scope: string): Promise<Git> {
    const repo = await this.repo(scope);
    const git = new Git(repo.dir);
    await git.assertRepo();
    // v2 data lives outside the repo, so branch switches cannot touch it.
    if (!repo.v2) await git.assertDataIgnored();
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
    const idx = await this.index(id);
    const hex = this.require(idx, id);
    if (!isWorkKind(hex.kind)) {
      throw new DomainError(`A ${hex.kind} is not worked on a branch`, 422);
    }
    if (roleOf(hex.status) === "terminal") {
      throw new DomainError(`${id} is already ${hex.status}`, 409);
    }
    const git = await this.git(id);
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
      return await this.mutate(id, (hexes) => {
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
   * depends on, so the work cannot be done until it is merged. Does not switch branches. When the
   * project has auto-merge on, it is merged straight away and the other outstanding branches are
   * brought up to date (see `autoMerge`); the pull request comes back as it ended up.
   */
  async openPullRequest(
    workId: string,
    opts: { title?: string | undefined; description?: string | undefined } = {},
  ): Promise<Hex> {
    const pr = await this.createPullRequest(workId, opts);
    const project = findProject(await this.index(workId), prefixOf(workId) ?? "");
    return autoMergeOn(project) ? await this.autoMerge(pr.id) : pr;
  }

  private async createPullRequest(
    workId: string,
    opts: { title?: string | undefined; description?: string | undefined },
  ): Promise<Hex> {
    const idx = await this.index(workId);
    const work = this.require(idx, workId);
    if (!isWorkKind(work.kind)) {
      throw new DomainError(`A ${work.kind} does not get pull requests`, 422);
    }
    if (roleOf(work.status) === "terminal") {
      throw new DomainError(`${workId} is already ${work.status}`, 409);
    }
    const branch = work.meta?.git_branch;
    if (!branch) throw new DomainError("Start work on a branch first", 409);
    const git = await this.git(workId);
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
      const { conflicts } = await git.mergeTree(main, branch);
      return await this.mutate(workId, async (hexes) => {
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
        markConflicts(pr, conflicts, t);
        w.dependsOn = unique([...(w.dependsOn ?? []), pr.id]);
        w.status = "in_review";
        w.lastUpdatedAtTimeInMs = t;
        reconcileReadiness(hexes, [workId], t);
        return pr;
      });
    });
  }

  /**
   * Merges a pull request into its target branch with a merge commit, without switching branches:
   * in place only when the target is checked out (see `Git.merge`). A conflict changes nothing in
   * git and is recorded on the pull request. Afterwards every other open pull request into the same
   * target is checked, so only the ones that now conflict are flagged. The diff is also saved to
   * `.hx/diffs/<id>.patch` for when the commits are gone.
   */
  async mergePullRequest(id: string): Promise<Hex> {
    const idx = await this.index(id);
    const pr = this.requirePullRequest(idx, id);
    const work = pr.meta?.work_hex ? idx.byId.get(pr.meta.work_hex) : undefined;
    const branch = pr.meta?.source_branch ?? "";
    const target = pr.meta?.target_branch ?? "";
    const git = await this.git(id);
    return await git.serial(async () => {
      await this.requireBranches(git, branch, target);
      if (await git.aheadOf(target, branch) === 0) {
        throw new DomainError(`${target} already has everything on ${branch}`, 409);
      }
      const label = work ? `${work.title} (${work.id})` : id;
      const head = await git.revParse(branch);
      const merge = await git.merge(target, branch, `Merge ${branch}: ${label}`);
      if (merge.sha === null) {
        await this.recordConflicts(id, new Map([[id, merge.conflicts]]));
        throw new DomainError(
          `Merging ${branch} into ${target} conflicts in ${merge.conflicts.join(", ")}. ` +
            `Update the branch from ${target}, or merge ${target} into ${branch}, resolve and ` +
            "commit, then merge again.",
          409,
        );
      }
      const mergeSha = merge.sha;
      const patch = await git.run(
        "diff",
        "--no-color",
        "--no-ext-diff",
        "-M",
        `${mergeSha}^1`,
        mergeSha,
      );
      const { diffs } = await this.repo(id);
      await Deno.mkdir(diffs, { recursive: true });
      await Deno.writeTextFile(`${diffs}/${id}.patch`, patch + "\n");
      const others = await this.conflictsOfOpenPullRequests(git, target, id);
      return await this.mutate(id, (hexes) => {
        const idx = buildIndex(hexes);
        const p = this.require(idx, id);
        const t = this.now();
        p.status = "merged";
        p.meta = {
          ...p.meta,
          head_sha: head,
          merge_sha: mergeSha,
          merged_at: new Date(t).toISOString(),
        };
        markConflicts(p, [], t);
        p.lastUpdatedAtTimeInMs = t;
        for (const [otherId, files] of others) {
          const other = idx.byId.get(otherId);
          if (other) markConflicts(other, files, t);
        }
        // The work is on main: it is finished, and what waits on it can start.
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

  /**
   * Merges a pull request that was just opened, then merges its target into every other
   * outstanding branch of the project. A merge that fails (a conflict, uncommitted changes on a
   * checked-out target) leaves the pull request open, as opening it without auto-merge would. What
   * happened is recorded as `meta.auto_merge_result`.
   */
  private async autoMerge(id: string): Promise<Hex> {
    let note: string;
    try {
      const merged = await this.mergePullRequest(id);
      const updates = await this.updateOutstandingBranches(merged);
      note = ["merged", ...updates].join("; ");
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      note = `not merged: ${e.message}`;
    }
    return await this.mutate(id, (hexes) => {
      const pr = this.require(buildIndex(hexes), id);
      pr.meta = { ...pr.meta, auto_merge_result: note };
      return pr;
    });
  }

  /**
   * After `merged` lands, merges its target into the project's outstanding branches: those of
   * other open pull requests into that target, and of unfinished work with no open pull request.
   * Like `updatePullRequestBranch`, nothing switches branches; a conflict changes nothing in git
   * and is recorded as `meta.merge_conflicts` on the pull request or work hex, and a branch checked
   * out with uncommitted changes is skipped. Returns one note per kind of outcome.
   */
  private async updateOutstandingBranches(merged: Hex): Promise<string[]> {
    const target = merged.meta?.target_branch ?? "";
    const git = await this.git(merged.id);
    return await git.serial(async () => {
      const idx = await this.index(merged.id);
      const branches = new Map<string, { id: string; pullRequest: boolean }>();
      for (const h of projectHexes(idx, prefixOf(merged.id) ?? "")) {
        if (
          h.kind === PULL_REQUEST_KIND && h.status === "pull_requested" && h.id !== merged.id &&
          h.meta?.target_branch === target && h.meta.source_branch
        ) {
          branches.set(h.meta.source_branch, { id: h.id, pullRequest: true });
        } else if (
          isWorkKind(h.kind) && roleOf(h.status) !== "terminal" && h.meta?.git_branch &&
          !pullRequestsOf(idx, h.id).some((p) => p.status === "pull_requested")
        ) {
          if (!branches.has(h.meta.git_branch)) {
            branches.set(h.meta.git_branch, { id: h.id, pullRequest: false });
          }
        }
      }
      const updated: string[] = [];
      const skipped: string[] = [];
      const conflicted: string[] = [];
      const outcomes = new Map<string, { conflicts: string[]; head?: string; base?: string }>();
      for (const [branch, { id, pullRequest }] of branches) {
        if (!await git.branchExists(branch)) continue;
        let conflicts: string[] = [];
        if (await git.aheadOf(branch, target) > 0) {
          try {
            conflicts =
              (await git.merge(branch, target, `Merge ${target} into ${branch}`)).conflicts;
          } catch (e) {
            if (!(e instanceof DomainError)) throw e;
            skipped.push(branch);
            continue;
          }
          if (conflicts.length) conflicted.push(`${branch} (${conflicts.join(", ")})`);
          else updated.push(branch);
        }
        outcomes.set(
          id,
          pullRequest
            ? {
              conflicts,
              head: await git.revParse(branch),
              base: await git.mergeBase(target, branch),
            }
            : { conflicts },
        );
      }
      await this.mutate(merged.id, (hexes) => {
        const idx = buildIndex(hexes);
        const t = this.now();
        for (const [id, { conflicts, head, base }] of outcomes) {
          const h = idx.byId.get(id);
          if (!h) continue;
          markConflicts(h, conflicts, t);
          if (head && h.meta?.head_sha !== head) {
            h.meta = { ...h.meta, base_sha: base!, head_sha: head };
            h.lastUpdatedAtTimeInMs = t;
          }
        }
      });
      return [
        ...(updated.length ? [`updated ${updated.sort().join(", ")}`] : []),
        ...(conflicted.length ? [`conflicts in ${conflicted.sort().join("; ")}`] : []),
        ...(skipped.length ? [`skipped ${skipped.sort().join(", ")} (uncommitted changes)`] : []),
      ];
    });
  }

  /**
   * Brings an open pull request's branch up to date by merging its target into it, without
   * switching branches (see `Git.merge`): a branch checked out somewhere must be clean. A conflict
   * changes nothing in git; it is recorded on the pull request and named, for someone to resolve on
   * the branch. Already up to date is fine and clears any recorded conflict.
   */
  async updatePullRequestBranch(id: string): Promise<Hex> {
    const idx = await this.index(id);
    const pr = this.requirePullRequest(idx, id);
    const branch = pr.meta?.source_branch ?? "";
    const target = pr.meta?.target_branch ?? "";
    const git = await this.git(id);
    return await git.serial(async () => {
      await this.requireBranches(git, branch, target);
      const conflicts = await git.aheadOf(branch, target) === 0
        ? []
        : (await git.merge(branch, target, `Merge ${target} into ${branch}`)).conflicts;
      const head = await git.revParse(branch);
      const base = await git.mergeBase(target, branch);
      const updated = await this.mutate(id, (hexes) => {
        const p = this.require(buildIndex(hexes), id);
        const t = this.now();
        markConflicts(p, conflicts, t);
        if (p.meta?.head_sha !== head) {
          p.meta = { ...p.meta, base_sha: base, head_sha: head };
          p.lastUpdatedAtTimeInMs = t;
        }
        return p;
      });
      if (conflicts.length) {
        throw new DomainError(
          `Merging ${target} into ${branch} conflicts in ${conflicts.join(", ")}. ` +
            `Merge ${target} into ${branch} on the branch, resolve and commit.`,
          409,
        );
      }
      return updated;
    });
  }

  private async requireBranches(git: Git, ...branches: string[]): Promise<void> {
    for (const b of branches) {
      if (!await git.branchExists(b)) {
        throw new DomainError(`The branch ${b} no longer exists`, 409);
      }
    }
  }

  /** For each open pull request into `target` (but `except`): the files it would conflict in. */
  private async conflictsOfOpenPullRequests(
    git: Git,
    target: string,
    except: string,
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    for (const p of (await this.index(except)).byId.values()) {
      const branch = p.meta?.source_branch;
      if (
        p.kind !== PULL_REQUEST_KIND || p.status !== "pull_requested" || p.id === except ||
        p.meta?.target_branch !== target || !branch || !await git.branchExists(branch)
      ) continue;
      out.set(p.id, (await git.mergeTree(target, branch)).conflicts);
    }
    return out;
  }

  private recordConflicts(scope: string, byId: Map<string, string[]>): Promise<void> {
    return this.mutate(scope, (hexes) => {
      const idx = buildIndex(hexes);
      const t = this.now();
      for (const [id, files] of byId) {
        const hex = idx.byId.get(id);
        if (hex) markConflicts(hex, files, t);
      }
    });
  }

  /**
   * Merges the open pull request of a work hex, so the work can be finished from its own page.
   * Everything else, including the hex statuses that follow, is `mergePullRequest`.
   */
  async mergeWork(workId: string): Promise<Hex> {
    const idx = await this.index(workId);
    const work = this.require(idx, workId);
    if (!isWorkKind(work.kind)) {
      throw new DomainError(`A ${work.kind} does not get pull requests`, 422);
    }
    const open = pullRequestsOf(idx, workId).filter((p) => p.status === "pull_requested");
    if (open.length === 0) throw new DomainError(`${workId} has no open pull request`, 409);
    if (open.length > 1) {
      throw new DomainError(
        `${workId} has ${open.length} open pull requests (${open.map((p) => p.id).join(", ")}). ` +
          "Merge one from its own page.",
        409,
      );
    }
    return await this.mergePullRequest(open[0]!.id);
  }

  /** Abandons a pull request: it is kept as a record, and its work hex no longer waits on it. */
  closePullRequest(id: string): Promise<Hex> {
    return this.mutate(id, (hexes) => {
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
    const idx = await this.index(id);
    const pr = this.require(idx, id);
    if (pr.kind !== PULL_REQUEST_KIND) throw new DomainError(`${id} is not a pull request`, 422);
    const m = pr.meta ?? {};
    const repo = await this.repo(id);
    const git = new Git(repo.dir);
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
        text = await Deno.readTextFile(`${repo.diffs}/${id}.patch`);
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

/** A hex as a hex-map cell, the shape hex search works over. */
function graphNode(h: Hex): GraphNode {
  return {
    id: h.id,
    title: h.title,
    kind: h.kind,
    status: h.status,
    blurb: blurb(h.description),
    gitBranch: h.meta?.git_branch ?? null,
    updatedAt: h.lastUpdatedAtTimeInMs,
  };
}

/** A repo path as `meta.files` lists it: trimmed, without a leading `./`. */
function normalisePath(path: string): string {
  return path.trim().replace(/^\.\//, "");
}

/** Records on a pull request the files its branch conflicts in with its target, or clears them. */
function markConflicts(pr: Hex, files: readonly string[], t: number): void {
  const now = files.join("\n");
  if ((pr.meta?.merge_conflicts ?? "") === now) return;
  const { merge_conflicts: _old, ...rest } = pr.meta ?? {};
  pr.meta = now ? { ...rest, merge_conflicts: now } : rest;
  pr.lastUpdatedAtTimeInMs = t;
}

/** The files a pull request's branch was last found to conflict in with its target. */
export function conflictsOf(pr: Hex): string[] {
  return pr.meta?.merge_conflicts?.split("\n").filter(Boolean) ?? [];
}

/** Hexes with duplicate ids dropped, keeping the first (a project may sit in two files). */
function uniqueById(hexes: readonly Hex[]): Hex[] {
  const seen = new Set<string>();
  return hexes.filter((h) => !seen.has(h.id) && seen.add(h.id));
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

function seedView(hex: Hex): SeedView {
  return {
    hex,
    gitUrl: hex.meta?.[SEED_GIT_URL_KEY] ?? "",
    branch: hex.meta?.[SEED_BRANCH_KEY] ?? "main",
    warnings: seedWarnings(hex),
  };
}
