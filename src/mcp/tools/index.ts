import { z } from "zod";
import { PEOPLE_ONLY, type Status } from "../../shared/constants.ts";
import { DomainError } from "../../server/core/errors.ts";
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
      name: "get_workspace",
      description: "Show which project directory is open and which project is selected.",
      kind: "read",
      input: z.object({}),
      run: () => s.state(),
    }),
    defineTool({
      name: "open_workspace",
      description: "Open an existing directory that contains .hx/data.json.",
      kind: "write",
      input: z.object({ dir: z.string().min(1).describe("Directory path; ~ is expanded") }),
      run: ({ dir }) => s.openWorkspace(dir),
    }),
    defineTool({
      name: "create_project",
      description:
        "Create a new project in a directory: writes .hx/data.json with a core.project hex whose " +
        "description is the project statement, and optionally runs git init.",
      kind: "write",
      input: z.object({
        dir: z.string().min(1),
        title: z.string().min(1),
        statement: z.string().default("").describe("Project statement / vision"),
        git_init: z.boolean().default(true),
      }),
      run: ({ dir, title, statement, git_init }) =>
        s.createProject({ dir, title, description: statement, gitInit: git_init }),
    }),
    defineTool({
      name: "list_projects",
      description: "List every core.project hex with epic and story counts.",
      kind: "read",
      input: z.object({}),
      run: () => s.listProjects(),
    }),
    defineTool({
      name: "list_recent_projects",
      description:
        "Projects opened recently, across every folder, newest first: dir, project_id, title, " +
        "whether each is still found, the current one, and whether it can be switched to.",
      kind: "read",
      input: z.object({}),
      run: () => s.recentProjects(),
    }),
    defineTool({
      name: "open_recent_project",
      description:
        "Switch to a recent project in one step: opens its folder (if it is not the open one) " +
        "and selects it. Take dir and project_id from list_recent_projects.",
      kind: "write",
      input: z.object({ dir: z.string().min(1), project_id: id }),
      run: ({ dir, project_id }) => s.openRecentProject(dir, project_id),
    }),
    defineTool({
      name: "get_selected_project",
      description: "Get the project stored in the studio.selected_project hex, or null.",
      kind: "read",
      input: z.object({}),
      run: async () => {
        const projectId = await s.selectedProjectId();
        return projectId ? await s.getHex(projectId) : null;
      },
    }),
    defineTool({
      name: "select_project",
      description: "Make a project the selected project (updates the studio.selected_project hex).",
      kind: "write",
      input: z.object({ project_id: id }),
      run: async ({ project_id }) => {
        await s.selectProject(project_id);
        return { selected: project_id };
      },
    }),
    defineTool({
      name: "get_project",
      description:
        "The project screen as data: the project hex, its designs, specs, decisions, questions and epics. Each epic " +
        "has its gate, progress {done,total,pct} and its stories sorted in_review → in_progress → " +
        "ready → blocked → merged/done.",
      kind: "read",
      input: z.object({ project_id: id }),
      run: ({ project_id }) => s.projectView(project_id),
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
          CORE_KINDS.filter((k) => k !== "pull_request").map((k) => `core.${k}`).join(", ")
        } (pull requests come from open_pull_request). Conventions: designs depend on the project; specs and decisions depend on a design; ` +
        "epics depend on designs, specs and stories; gates depend on epics. Status defaults to blocked; " +
        "'ready' needs every dependency done. The id is hashed from title, kind and createdAt. " +
        STATUS_RULES,
      kind: "write",
      input: z.object({
        project_id: id.describe("The project the hex belongs to"),
        kind: KindSchema,
        title: z.string().min(1),
        description: z.string().default(""),
        status: StatusSchema.default("blocked"),
        depends_on: z.array(id).default([]).describe("Hexes that must be done first"),
        required_by: z.array(id).default([]).describe("Hexes that will depend on this one"),
        emerged_from: id.optional().describe("The hex being worked on when this was discovered"),
        meta: MetaSchema.default({}),
      }),
      run: (a) => {
        refusePeopleOnly(a.status);
        return s.createHex({
          projectId: a.project_id,
          kind: a.kind,
          title: a.title,
          description: a.description,
          status: a.status,
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
      run: ({ id, title, description }) => s.updateHex(id, { title, description }),
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
      run: ({ id, status, response }) => {
        refusePeopleOnly(status);
        return s.updateHex(id, { status, response });
      },
    }),
    defineTool({
      name: "delete_hex",
      description:
        "Permanently delete a hex and scrub references to it. Deleting a core.project deletes every " +
        "hex in that project. Mirrors Studio's double confirmation: pass confirm=true.",
      kind: "destructive",
      input: z.object({ id, confirm: z.literal(true).describe("Must be true") }),
      run: async ({ id }) => ({ deleted: await s.deleteHex(id) }),
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
        "the pull request until it is merged. Next: the user reviews; merge_pull_request only when " +
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
        "Merge a pull request into main with a merge commit, in the working tree (main stays " +
        "checked out). Only when the user asks. A conflict changes nothing and names the files: " +
        "merge main into the branch, resolve, commit, and try again. It moves the work hex to " +
        "merged; no further status change is needed.",
      kind: "write",
      input: z.object({ id: id.describe("The pull request") }),
      run: ({ id }) => s.mergePullRequest(id),
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
      run: ({ id, depends_on_id }) => s.addDependency(id, depends_on_id),
    }),
    defineTool({
      name: "remove_dependency",
      description: "Remove `depends_on_id` from `id`'s dependencies.",
      kind: "write",
      input: z.object({ id, depends_on_id: id }),
      run: ({ id, depends_on_id }) => s.removeDependency(id, depends_on_id),
    }),

    // ── meta ──────────────────────────────────────────────────────────────
    defineTool({
      name: "add_meta_state_to_hex_with_id",
      description: "Add a new meta key/value to a hex. Fails if the key already exists.",
      kind: "write",
      input: z.object({ id, key, value }),
      run: ({ id, key, value }) => s.setMeta(id, key, value, "add"),
    }),
    defineTool({
      name: "update_meta_state_to_hex_with_id",
      description: "Change the value of an existing meta key. Fails if the key does not exist.",
      kind: "write",
      input: z.object({ id, key, value }),
      run: ({ id, key, value }) => s.setMeta(id, key, value, "update"),
    }),
    defineTool({
      name: "remove_meta_state_from_hex_with_id",
      description: "Remove a meta key from a hex.",
      kind: "write",
      input: z.object({ id, key }),
      run: ({ id, key }) => s.removeMeta(id, key),
    }),
  ];
}
