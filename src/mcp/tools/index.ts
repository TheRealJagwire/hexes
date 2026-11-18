import { z } from "zod";
import { defaultStatus, PEOPLE_ONLY, type Status } from "../../shared/constants.ts";
import { DomainError } from "../../server/core/errors.ts";
import { AUTO_MERGE_KEY, IDEA_KIND } from "../../shared/graph.ts";
import {
  CORE_KINDS,
  HexIdSchema,
  KindSchema,
  MetaSchema,
  StatusSchema,
} from "../../shared/schemas.ts";
import type { HexService } from "../../server/core/service.ts";
import { defineTool } from "./define.ts";

const id = HexIdSchema.describe("Hex id, e.g. hx-studio-4a1");
const key = z.string().min(1).describe("Meta key, e.g. git_branch or desired_language");
const value = z.string().describe("Meta value");

/** Blessing is a person's approval; agents ask for it instead of setting it. */
function refusePeopleOnly(status: Status): void {
  if (PEOPLE_ONLY.includes(status)) {
    throw new DomainError(
      `Only a person can set ${status}. Ask the user to do it in Studio.`,
      403,
    );
  }
}

/** Ideas are a person's words: agents read them and build on them, but never change them. */
async function refuseIdeas(s: HexService, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    if ((await s.getHex(id)).kind === IDEA_KIND) {
      throw new DomainError("Ideas belong to people: ask the user to change it in Studio", 403);
    }
  }
}

/** Auto-merge decides whether work reaches main without a person: only people change it. */
async function refuseAutoMergeSetting(s: HexService, id: string, key: string): Promise<void> {
  if (key === AUTO_MERGE_KEY && (await s.getHex(id)).kind === "core.project") {
    throw new DomainError(
      "Only a person turns auto-merge on or off. Ask the user to use the switch in Studio.",
      403,
    );
  }
}

const STATUS_RULES = "Statuses depend on the kind: designs and specs use blessed (set only by a " +
  "person in Studio) instead of ready; questions use answered instead of done, which needs a response; " +
  "work (story, substory, bug, custom kinds) goes in_progress → in_review when a pull request is " +
  "opened → merged when it is merged, and in_review and merged are never set by hand.";

/**
 * Every Studio action as an MCP tool. The names called out in SPEC.md keep their exact
 * spelling; the rest cover the Studio flows (workspace, projects, create/update/delete).
 */
export function buildTools(s: HexService) {
  return [
    // ── workspace & projects ──────────────────────────────────────────────
    defineTool({
      name: "create_project",
      description:
        "Create a new project for a repository directory: writes ~/.hx/projects/<id>/data.json " +
        "with a core.project hex (description = the statement, meta.repo_path = dir, " +
        "meta.schema_version = 2), writes dir/.hx/project.json naming it, and optionally runs " +
        "git init in dir.",
      kind: "write",
      input: z.object({
        dir: z.string().default("").describe(
          "The repository folder; leave empty to pick one later with set_project_repo",
        ),
        title: z.string().min(1),
        statement: z.string().default("").describe("Project statement / vision"),
        git_init: z.boolean().default(true),
      }),
      run: ({ dir, title, statement, git_init }) =>
        s.createProject({ dir, title, description: statement, gitInit: git_init }),
    }),
    defineTool({
      name: "list_projects",
      description:
        "List every project with epic and story counts, from ~/.hx/projects. Use it to ask the " +
        "user which project a folder belongs to when it has no .hx/project.json.",
      kind: "read",
      input: z.object({}),
      run: () => s.listProjects(),
    }),
    defineTool({
      name: "list_recent_projects",
      description:
        "Projects people opened recently in Studio, newest first: repo path, project_id, title " +
        "and whether each is still found.",
      kind: "read",
      input: z.object({}),
      run: () => s.recentProjects(),
    }),
    defineTool({
      name: "find_project",
      description:
        "The project a folder belongs to: reads the nearest .hx/project.json at or above dir " +
        "(the repository names its project there). Returns { project_id, dir, project } or " +
        "null when no folder above names one. Pass the absolute path of your working directory.",
      kind: "read",
      input: z.object({ dir: z.string().min(1).describe("Absolute folder path; ~ is expanded") }),
      run: async ({ dir }) => {
        const found = await s.findProject(dir);
        return found
          ? { project_id: found.projectId, dir: found.dir, project: found.project }
          : null;
      },
    }),
    defineTool({
      name: "get_project",
      description:
        "The project screen as data: the project hex, its gates (milestones, in order, each with its " +
        "epics' progress), designs, specs, decisions, questions and epics. Each epic " +
        "has its gate, progress {done,total,pct} and its stories sorted in_review → in_progress → " +
        "ready → blocked → merged/done.",
      kind: "read",
      input: z.object({ project_id: id }),
      run: ({ project_id }) => s.projectView(project_id),
    }),

    defineTool({
      name: "get_facts",
      description:
        "Facts (core.fact) recorded about a project: durable statements, each linked to the hexes " +
        "it is about. Before starting a hex, call this with near set to it: you get the facts " +
        "within depth hops (default 2, max 4) over links in either direction (never through the " +
        "project), nearest first, each with the path that reached it. file keeps facts whose " +
        "meta.files lists that repo path; query matches titles by word prefix. Filters combine. " +
        "Only known facts unless include_retired.",
      kind: "read",
      input: z.object({
        project_id: id,
        near: id.optional().describe("A hex in the project to start from"),
        depth: z.number().int().min(1).max(4).optional().describe("Hops from near; default 2"),
        file: z.string().optional().describe("A repo path, e.g. src/mcp/channel.ts"),
        query: z.string().optional(),
        include_retired: z.boolean().optional(),
      }),
      run: ({ project_id, near, depth, file, query, include_retired }) =>
        s.facts(project_id, { near, depth, file, query, includeRetired: include_retired }),
    }),

    defineTool({
      name: "set_project_repo",
      description:
        "Give a project its repository (until it has one, its stories and bugs are not ready). " +
        "With seed_id: clone that repository seed into dir (missing or empty), rename its " +
        "origin remote to seed, and record meta.repo_ref_hx. Without: use dir, an existing git " +
        "working tree. Sets meta.repo_path. Forking creates a folder on the user's disk: " +
        "recommend a seed (list_seeds) with a sentence on why it fits, and only fork once the " +
        "person says so.",
      kind: "write",
      input: z.object({
        project_id: id,
        dir: z.string().min(1).describe("Target folder; ~ is expanded"),
        seed_id: id.optional(),
      }),
      run: ({ project_id, dir, seed_id }) => s.setProjectRepo(project_id, { dir, seedId: seed_id }),
    }),

    // ── repository seeds ─────────────────────────────────────────────────
    defineTool({
      name: "list_seeds",
      description:
        "Repository seeds (core.seed): git repositories shared by every project that a new " +
        "project can be forked from. Each has a short description of its stack, what works out " +
        "of the box and what it fits; use it to judge fit. Only available seeds unless " +
        "include_retired.",
      kind: "read",
      input: z.object({ include_retired: z.boolean().optional() }),
      run: ({ include_retired }) => s.listSeeds({ includeRetired: include_retired }),
    }),
    defineTool({
      name: "create_seed",
      description:
        "Add a repository seed, shared across projects. Keep the description to about 5 lines: " +
        "the stack, what works out of the box, and what it is a good and a poor fit for (over " +
        "600 characters is flagged in warnings). git_url is anything git clone accepts.",
      kind: "write",
      input: z.object({
        title: z.string().min(1),
        description: z.string().default(""),
        git_url: z.string().min(1),
        branch: z.string().optional().describe("Defaults to main"),
      }),
      run: ({ title, description, git_url, branch }) =>
        s.createSeed({ title, description, gitUrl: git_url, branch }),
    }),
    defineTool({
      name: "update_seed",
      description:
        "Change a repository seed's title, description (about 5 lines), git_url or branch. " +
        "Only what is given changes.",
      kind: "write",
      input: z.object({
        seed_id: id,
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        git_url: z.string().min(1).optional(),
        branch: z.string().min(1).optional(),
      }),
      run: ({ seed_id, title, description, git_url, branch }) =>
        s.updateSeed(seed_id, { title, description, gitUrl: git_url, branch }),
    }),
    defineTool({
      name: "retire_seed",
      description:
        "Stop offering a repository seed (status retired); restore: true offers it again. " +
        "Projects already forked from it are unaffected.",
      kind: "write",
      input: z.object({ seed_id: id, restore: z.boolean().optional() }),
      run: ({ seed_id, restore }) => s.retireSeed(seed_id, restore ?? false),
    }),

    // ── hexes ─────────────────────────────────────────────────────────────
    defineTool({
      name: "get_hex_by_id",
      description: "Get one hex with all of its fields.",
      kind: "read",
      input: z.object({ id }),
      run: ({ id }) => s.getHex(id),
    }),
    defineTool({
      name: "get_hex_view",
      description:
        "The hex screen as data: the hex, its breadcrumb trail (project › gate › epic …), what it " +
        "depends on, what depends on it, and what emerged from it.",
      kind: "read",
      input: z.object({ id }),
      run: ({ id }) => s.hexView(id),
    }),
    defineTool({
      name: "get_breadcrumbs",
      description: "Breadcrumb trail for a hex, root first, ending with the hex itself.",
      kind: "read",
      input: z.object({ id }),
      run: ({ id }) => s.breadcrumbsOf(id),
    }),
    defineTool({
      name: "search_hexes",
      description:
        "Find hexes by id/title substring, kind or status, optionally within one project.",
      kind: "read",
      input: z.object({
        project_id: id.optional(),
        query: z.string().optional(),
        kind: KindSchema.optional(),
        status: StatusSchema.optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      run: ({ project_id, query, kind, status, limit }) =>
        s.search({ projectId: project_id, query, kind, status, limit }),
    }),
    defineTool({
      name: "create_hex",
      description:
        `Create a hex in a project. Kinds are <category>.<qualifier>; core kinds: ${
          CORE_KINDS.filter((k) => k !== "pull_request" && k !== "idea").map((k) => `core.${k}`)
            .join(", ")
        } (pull requests come from open_pull_request; ideas, core.idea, only from people). Conventions: designs depend on the project, and on the idea they design when there is one; specs and decisions depend on a design; ` +
        "epics depend on designs, specs and stories; gates depend on epics. A fact (core.fact) is one " +
        "durable sentence about the project as its title, depending on the project and the hexes it " +
        "is about; it starts known, and to replace one, set the old one retired with " +
        "meta.superseded_by. Status defaults to blocked, or to the kind's first status when it has " +
        "no blocked (a fact: known); 'ready' needs every dependency done. The id is hashed from title, kind and createdAt. " +
        STATUS_RULES,
      kind: "write",
      input: z.object({
        project_id: id.describe("The project the hex belongs to"),
        kind: KindSchema,
        title: z.string().min(1),
        description: z.string().default(""),
        status: StatusSchema.optional().describe("Defaults to the kind's starting status"),
        depends_on: z.array(id).default([]).describe("Hexes that must be done first"),
        required_by: z.array(id).default([]).describe("Hexes that will depend on this one"),
        emerged_from: id.optional().describe("The hex being worked on when this was discovered"),
        meta: MetaSchema.default({}),
      }),
      run: async (a) => {
        if (a.kind === IDEA_KIND) {
          throw new DomainError(
            "Ideas come from people: ask the user to write it in Studio",
            403,
          );
        }
        const status = a.status ?? defaultStatus(a.kind);
        refusePeopleOnly(status);
        await refuseIdeas(s, a.required_by);
        return await s.createHex({
          projectId: a.project_id,
          kind: a.kind,
          title: a.title,
          description: a.description,
          status,
          dependsOn: a.depends_on,
          requiredBy: a.required_by,
          emergedFrom: a.emerged_from,
          meta: a.meta,
        });
      },
    }),
    defineTool({
      name: "update_hex",
      description: "Change a hex's title and/or description.",
      kind: "write",
      input: z.object({
        id,
        title: z.string().min(1).optional(),
        description: z.string().optional(),
      }),
      run: async ({ id, title, description }) => {
        await refuseIdeas(s, [id]);
        return await s.updateHex(id, { title, description });
      },
    }),
    defineTool({
      name: "update_hex_status",
      description:
        "Set a hex's status. Finishing a hex promotes blocked dependents whose dependencies are " +
        "now all done to ready. 'ready' is refused while a dependency is not done. " +
        STATUS_RULES + " Answering a question creates a core.decision holding the response; its " +
        "id is returned in the question's meta.decision.",
      kind: "write",
      input: z.object({
        id,
        status: StatusSchema,
        response: z.string().optional().describe(
          "Required when setting a question to answered: the answer, in markdown",
        ),
      }),
      run: async ({ id, status, response }) => {
        refusePeopleOnly(status);
        await refuseIdeas(s, [id]);
        return await s.updateHex(id, { status, response });
      },
    }),
    defineTool({
      name: "delete_hex",
      description:
        "Permanently delete a hex and scrub references to it. Deleting a core.project deletes every " +
        "hex in that project. Mirrors Studio's double confirmation: pass confirm=true.",
      kind: "destructive",
      input: z.object({ id, confirm: z.literal(true).describe("Must be true") }),
      run: async ({ id }) => {
        await refuseIdeas(s, [id]);
        return { deleted: await s.deleteHex(id) };
      },
    }),

    // ── branches & pull requests ──────────────────────────────────────────
    defineTool({
      name: "start_work_branch",
      description: "Start work on a work hex (story, substory, bug, …) on its own git branch, " +
        "hx/<id>-<slug> off main, and switch the working tree to it. Records meta.git_branch and " +
        "moves the hex to in_progress. Safe to call again to switch back. Refused with uncommitted " +
        "changes. Then commit on the branch and call open_pull_request.",
      kind: "write",
      input: z.object({ id }),
      run: ({ id }) => s.startWork(id),
    }),
    defineTool({
      name: "open_pull_request",
      description:
        "Open a pull request (a core.pull_request hex, status pull_requested) for a work hex's " +
        "branch once it has commits. It moves the work hex to in_review; the work hex depends on " +
        "the pull request until it is merged. When the project has auto-merge on (get_project's " +
        "autoMerge, on by default), Studio merges it at once and merges main into the other open " +
        "branches: the result is status merged, with meta.auto_merge_result saying what happened, " +
        "and there is no review step. If that merge conflicts, it stays pull_requested with " +
        "meta.merge_conflicts. With auto-merge off: the user reviews; merge_pull_request only when " +
        "they say so.",
      kind: "write",
      input: z.object({
        id: id.describe("The work hex"),
        title: z.string().optional().describe("Defaults to 'PR: <work title>'"),
        description: z.string().optional(),
      }),
      run: ({ id, title, description }) => s.openPullRequest(id, { title, description }),
    }),
    defineTool({
      name: "merge_pull_request",
      description:
        "Merge a pull request into main with a merge commit, without switching branches (if main " +
        "is checked out it merges there, and that tree must be clean). Only when the user asks. " +
        "A conflict changes nothing in git, is recorded as meta.merge_conflicts and names the " +
        "files: update_pull_request_branch, or merge main into the branch, resolve, commit, and " +
        "try again. It moves the work hex to merged; no further status change is needed. Other " +
        "open pull requests that now conflict with main get meta.merge_conflicts; the rest need " +
        "no update.",
      kind: "write",
      input: z.object({ id: id.describe("The pull request") }),
      run: ({ id }) => s.mergePullRequest(id),
    }),
    defineTool({
      name: "update_pull_request_branch",
      description:
        "Bring an open pull request's branch up to date by merging main into it, without " +
        "switching branches (a branch checked out somewhere must be clean). Only needed when " +
        "meta.merge_conflicts is set or the user asks: a branch merely behind main merges fine. " +
        "A conflict changes nothing and names the files: switch to the branch, merge main, " +
        "resolve and commit, then call this again to clear the flag.",
      kind: "write",
      input: z.object({ id: id.describe("The pull request") }),
      run: ({ id }) => s.updatePullRequestBranch(id),
    }),
    defineTool({
      name: "close_pull_request",
      description:
        "Abandon a pull request without merging. It is kept (status closed) and its work hex no " +
        "longer waits on it; the branch is kept too. A work hex in_review goes back to in_progress.",
      kind: "write",
      input: z.object({ id: id.describe("The pull request") }),
      run: ({ id }) => s.closePullRequest(id),
    }),
    defineTool({
      name: "get_pull_request_diff",
      description:
        "What a pull request changes: each file's status and +/- counts, and the unified patch. " +
        "Merged: the merge commit; open: the branch since it left main.",
      kind: "read",
      input: z.object({ id: id.describe("The pull request") }),
      run: async ({ id }) => {
        const diff = await s.pullRequestDiff(id);
        return {
          source: diff.source,
          truncated: diff.truncated,
          files: diff.files.map(({ hunks: _, ...file }) => file),
          patch: diff.files.map((f) =>
            [
              `--- ${f.oldPath ?? f.path}`,
              `+++ ${f.path}`,
              ...(f.binary ? ["(binary)"] : []),
              ...f.hunks.flatMap((h) => [
                h.header,
                ...h.lines.map((l) =>
                  (l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ") + l.text
                ),
              ]),
            ].join("\n")
          ).join("\n"),
        };
      },
    }),

    // ── readiness & the dependency graph ──────────────────────────────────
    defineTool({
      name: "get_ready_hexes",
      description:
        "Hexes that can be picked up (ready, or blessed designs and specs) whose dependencies are all " +
        "done, " +
        "across every project.",
      kind: "read",
      input: z.object({}),
      run: () => s.ready(),
    }),
    defineTool({
      name: "get_ready_hexes_for_project",
      description:
        "Hexes that can be picked up (ready, or blessed designs and specs, with all dependencies " +
        "done) " +
        "within one project.",
      kind: "read",
      input: z.object({ project_id: id }),
      run: ({ project_id }) => s.ready(project_id),
    }),
    defineTool({
      name: "get_hexes_that_depend_on_hex_with_id",
      description: "Hexes whose dependsOn contains this id.",
      kind: "read",
      input: z.object({ id }),
      run: ({ id }) => s.dependents(id),
    }),
    defineTool({
      name: "get_hexes_that_this_hex_depends_on",
      description: "The hexes listed in this hex's dependsOn.",
      kind: "read",
      input: z.object({ id }),
      run: ({ id }) => s.dependencies(id),
    }),
    defineTool({
      name: "add_dependency",
      description: "Make `id` depend on `depends_on_id`. Cycles are refused.",
      kind: "write",
      input: z.object({ id, depends_on_id: id }),
      run: async ({ id, depends_on_id }) => {
        await refuseIdeas(s, [id]);
        return await s.addDependency(id, depends_on_id);
      },
    }),
    defineTool({
      name: "remove_dependency",
      description: "Remove `depends_on_id` from `id`'s dependencies.",
      kind: "write",
      input: z.object({ id, depends_on_id: id }),
      run: async ({ id, depends_on_id }) => {
        await refuseIdeas(s, [id]);
        return await s.removeDependency(id, depends_on_id);
      },
    }),

    // ── meta ──────────────────────────────────────────────────────────────
    defineTool({
      name: "add_meta_state_to_hex_with_id",
      description: "Add a new meta key/value to a hex. Fails if the key already exists.",
      kind: "write",
      input: z.object({ id, key, value }),
      run: async ({ id, key, value }) => {
        await refuseIdeas(s, [id]);
        await refuseAutoMergeSetting(s, id, key);
        return await s.setMeta(id, key, value, "add");
      },
    }),
    defineTool({
      name: "update_meta_state_to_hex_with_id",
      description: "Change the value of an existing meta key. Fails if the key does not exist.",
      kind: "write",
      input: z.object({ id, key, value }),
      run: async ({ id, key, value }) => {
        await refuseIdeas(s, [id]);
        await refuseAutoMergeSetting(s, id, key);
        return await s.setMeta(id, key, value, "update");
      },
    }),
    defineTool({
      name: "remove_meta_state_from_hex_with_id",
      description: "Remove a meta key from a hex.",
      kind: "write",
      input: z.object({ id, key }),
      run: async ({ id, key }) => {
        await refuseIdeas(s, [id]);
        await refuseAutoMergeSetting(s, id, key);
        return await s.removeMeta(id, key);
      },
    }),
  ];
}
