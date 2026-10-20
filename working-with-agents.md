# Working with Agents

How an AI agent (Claude Code or any MCP client) works with Hexes through the `hexes` MCP server.
Part 1 is the tool reference; Part 2 is a set of skills (repeatable playbooks) built on those tools.

## Setup

Studio serves the MCP server itself over streamable HTTP at `http://localhost:8000/mcp`, in the same
process as the UI, so both share one service. **Start Studio first** (`deno task start`); if it is
not running the `hexes` tools fail to connect. `.mcp.json` registers it:

```json
{ "mcpServers": { "hexes": { "type": "http", "url": "http://localhost:8000/mcp" } } }
```

If Studio is restarted, reconnect with `/mcp` in Claude Code. A stdio entry (`deno task mcp`) still
exists for clients that need a spawned process; it runs as a separate process from Studio, so it
does not share Studio's write lock (the UI still picks up its changes).

Studio updates live: anything an agent writes through these tools appears in an open Studio tab
within a moment, with no refresh. Studio also truncates a project's description to ten lines on the
project screen (the full text is on the hex's own page), so put the essentials first. Its **Hex
map** shows the whole project as a grid of cells coloured by status, placed next to the hexes they
link to; it is for people, with no MCP tool, so a mis-wired dependency shows up there as a hex far
from where it belongs.

In Claude Code the tools appear as `mcp__hexes__<tool_name>`. Every tool returns JSON text; domain
failures (cycle, unknown id, `ready` with unfinished dependencies, a status the kind doesn't use, …)
come back as tool errors with a readable message, so read the message and adjust rather than
retrying blindly.

## Model in one minute

- A **hex** is the single unit of project state: `id`, `kind`, `title`, `description`, `status`,
  `dependsOn`, `emergedFrom`, `meta` (string → string).
- **Ids** look like `hx-<prefix>-<hex>` (e.g. `hx-studio-4a1`). The suffix is 3 hex characters and
  grows by one character when a new hex collides with an existing id (e.g. `hx-realtime-a925`), so
  never assume a fixed length; ids are opaque.
- **Kinds** are `<category>.<qualifier>`. Core kinds: `core.project`, `core.design`, `core.spec`,
  `core.decision`, `core.gate`, `core.epic`, `core.story`, `core.substory`, `core.bug`,
  `core.question`. Custom kinds are allowed. `studio.selected_project` is internal.
- **Statuses** depend on the kind. Most kinds go `blocked` → `ready` → `in_progress` → `verified` →
  `done`. These kinds differ:
  - **Designs and specs**: `blocked` → `in_progress` → `blessed` → `done`. `blessed` replaces
    `ready`: a person has approved it. A blessed design is ready to be broken down; a blessed spec
    is ready to be built, so the work that depends on it unblocks. Only a person blesses, in Studio;
    the MCP tools refuse `blessed`, and nothing is ever blessed automatically.
  - **Questions**: `blocked` → `ready` → `in_progress` → `answered`. `answered` replaces `done` and
    needs a `response`. Answering stores the response on the question (`meta.answer`) and creates a
    `done` `core.decision` holding it (`meta.decision` is its id); whatever depended on the question
    then depends on the decision too. A question is answered once; revise the decision instead.
  - A dependency is satisfied by `done`, `answered` or `blessed`. `ready` is refused while any
    dependency is unsatisfied, and satisfying the last one auto-promotes blocked dependents to
    `ready` (designs and specs excepted: they wait for a person).
  - **Pull requests** (`core.pull_request`): `pull_requested` → `merged` or `closed`. They are only
    created by `open_pull_request` and only move by `merge_pull_request` / `close_pull_request`.
  - `GET /api/statuses` returns the full table: each status's role and each kind's statuses.
- **Work goes through pull requests.** Work hexes (story, substory, bug, custom kinds) are built on
  their own branch and reach main only by merging a pull request:
  1. `start_work_branch`: Hexes creates `hx/<id>-<slug>` off main, switches the working tree to it,
     records `meta.git_branch` and moves the hex to `in_progress`.
  2. Commit the work on that branch.
  3. `open_pull_request`: a `core.pull_request` hex; the work hex now depends on it.
  4. The user reviews (Studio shows the changes, `get_pull_request_diff` too). Only when they say
     so: `merge_pull_request`. main is then checked out, and the PR records its merge commit.
  5. `update_hex_status` → `done` on the work hex. It is refused while none of its PRs is merged.
  - Hexes runs git in the project's own working tree and refuses while tracked files have
    uncommitted changes (commit or stash them first). `.hx/` must be in `.gitignore`.
  - A conflicting merge changes nothing and names the files. On the branch, merge main in, resolve,
    commit, then merge again. To give up on a PR, `close_pull_request` (it is kept as a record and
    the work stops waiting on it); open a new one later from the same branch.
  - After a merge, the work hex's page in Studio and the app has a diff view of what landed.
- **Conventions**: projects own designs, gates and bugs; designs own decisions and specs; gates
  depend on epics; epics depend on designs, specs and stories; stories may have substories. A
  _dependency_ means "must be done first".

## Part 1: Tool definitions

Annotations: **R** = read-only (safe to auto-approve), **W** = write, **D** = destructive (gate it).

### Workspace & projects

| Tool                   | Kind | Input                                           | Purpose                                                                                                                                                          |
| ---------------------- | ---- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_workspace`        | R    | –                                               | Which directory is open and which project is selected. Start here.                                                                                               |
| `open_workspace`       | W    | `dir`                                           | Open a directory containing `.hx/data.json` (`~` expanded).                                                                                                      |
| `create_project`       | W    | `dir`, `title`, `statement=""`, `git_init=true` | Write `.hx/data.json` with a `core.project` hex; `statement` becomes its description.                                                                            |
| `list_projects`        | R    | –                                               | All `core.project` hexes with epic/story counts.                                                                                                                 |
| `get_selected_project` | R    | –                                               | The selected project hex, or `null`.                                                                                                                             |
| `select_project`       | W    | `project_id`                                    | Make a project the selected one.                                                                                                                                 |
| `list_recent_projects` | R    | –                                               | Projects opened recently in any folder, newest first, with whether each is still found and can be switched to.                                                   |
| `open_recent_project`  | W    | `dir`, `project_id`                             | Switch to a recent project in one step: opens its folder if needed and selects it.                                                                               |
| `get_project`          | R    | `project_id`                                    | Project screen as data: designs, decisions, epics (each with gate, `progress {done,total,pct}`, stories sorted in_progress → verified → ready → blocked → done). |

### Hexes

| Tool                | Kind | Input                                                                                                                              | Purpose                                                                                                                                                                                  |
| ------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_hex_by_id`     | R    | `id`                                                                                                                               | One hex, all fields.                                                                                                                                                                     |
| `get_hex_view`      | R    | `id`                                                                                                                               | Hex + breadcrumbs + dependencies + dependents + what emerged from it. Best single call for context on one hex.                                                                           |
| `get_breadcrumbs`   | R    | `id`                                                                                                                               | Trail from root to the hex (project › gate › epic …).                                                                                                                                    |
| `search_hexes`      | R    | `project_id?`, `query?`, `kind?`, `status?`, `limit?` (1–200)                                                                      | Find hexes by id/title substring, kind, status.                                                                                                                                          |
| `create_hex`        | W    | `project_id`, `kind`, `title`, `description=""`, `status="blocked"`, `depends_on=[]`, `required_by=[]`, `emerged_from?`, `meta={}` | Create a hex. `required_by` makes existing hexes depend on the new one.                                                                                                                  |
| `update_hex`        | W    | `id`, `title?`, `description?`                                                                                                     | Edit title/description.                                                                                                                                                                  |
| `update_hex_status` | W    | `id`, `status`, `response?`                                                                                                        | Move a hex through its kind's lifecycle; finishing it unblocks dependents. `response` is required to set a question `answered`; the result's `meta.decision` is the decision it created. |
| `delete_hex`        | D    | `id`, `confirm: true`                                                                                                              | Permanently delete and scrub references. Deleting a `core.project` deletes the whole project.                                                                                            |

### Readiness & dependency graph

| Tool                                   | Kind | Input                 | Purpose                                                                                                          |
| -------------------------------------- | ---- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `get_ready_hexes`                      | R    | –                     | Hexes that can be picked up (`ready`, or blessed designs) with every dependency satisfied, across every project. |
| `get_ready_hexes_for_project`          | R    | `project_id`          | Same, within one project. The agent's "what next?" query.                                                        |
| `get_hexes_that_depend_on_hex_with_id` | R    | `id`                  | Downstream hexes (what this unblocks).                                                                           |
| `get_hexes_that_this_hex_depends_on`   | R    | `id`                  | Upstream hexes (what this waits on).                                                                             |
| `add_dependency`                       | W    | `id`, `depends_on_id` | `id` now waits on `depends_on_id`. Cycles refused.                                                               |
| `remove_dependency`                    | W    | `id`, `depends_on_id` | Drop that edge.                                                                                                  |

### Branches & pull requests

| Tool                    | Kind | Input                          | Purpose                                                                       |
| ----------------------- | ---- | ------------------------------ | ----------------------------------------------------------------------------- |
| `start_work_branch`     | W    | `id`                           | Put a work hex on `hx/<id>-<slug>` off main and switch to it; safe to repeat. |
| `open_pull_request`     | W    | `id`, `title?`, `description?` | Open a PR for the work hex's branch once it has commits.                      |
| `merge_pull_request`    | W    | `id` (the PR)                  | Merge into main with a merge commit. Only when the user asks.                 |
| `close_pull_request`    | W    | `id` (the PR)                  | Abandon a PR; it is kept, and the work no longer waits on it.                 |
| `get_pull_request_diff` | R    | `id` (the PR)                  | File summaries and a compact patch of what it changes.                        |

`get_hex_view` on a work hex includes `workBranch` and `pullRequests`; on a PR, `workHex`.

### Meta

Meta holds work-tracking facts such as `git_branch`, `pr_url`, `desired_language`, `assignee`.

| Tool                                 | Kind | Input                | Purpose                               |
| ------------------------------------ | ---- | -------------------- | ------------------------------------- |
| `add_meta_state_to_hex_with_id`      | W    | `id`, `key`, `value` | Add a key; fails if it exists.        |
| `update_meta_state_to_hex_with_id`   | W    | `id`, `key`, `value` | Change a key; fails if it is missing. |
| `remove_meta_state_from_hex_with_id` | W    | `id`, `key`          | Remove a key.                         |

Add vs. update are strict, so check `meta` on the hex first (or handle the error by switching call).

### Suggested permissions (`.claude/settings.json`)

Auto-allow the read tools; leave writes prompting, and `delete_hex` always prompting.

```json
{
  "permissions": {
    "allow": [
      "mcp__hexes__get_workspace",
      "mcp__hexes__list_projects",
      "mcp__hexes__get_selected_project",
      "mcp__hexes__get_project",
      "mcp__hexes__get_hex_by_id",
      "mcp__hexes__get_hex_view",
      "mcp__hexes__get_breadcrumbs",
      "mcp__hexes__search_hexes",
      "mcp__hexes__get_ready_hexes",
      "mcp__hexes__get_ready_hexes_for_project",
      "mcp__hexes__get_hexes_that_depend_on_hex_with_id",
      "mcp__hexes__get_hexes_that_this_hex_depends_on"
    ],
    "ask": ["mcp__hexes__delete_hex"]
  }
}
```

## Part 2: Skills

Each skill is a playbook: when to use it, the steps, and the rules. They can be pasted into
`CLAUDE.md`, or saved as `.claude/skills/<name>/SKILL.md` (the `name`/`description` header is
included for that purpose).

---

### Skill: `hexes-orient`

```markdown
---
name: hexes-orient
description: Get oriented in a Hexes workspace — find the open project, its state, and what to work on next. Use at the start of a session or when asked "where are we / what's next".
---

1. `get_workspace`. If no workspace is open, ask the user for the directory and `open_workspace`.
2. `get_selected_project`. If null, `list_projects`; if there is exactly one, `select_project` it,
   otherwise ask the user which. If the project they mean is in another folder,
   `list_recent_projects` and `open_recent_project` switch to it in one step.
3. `get_project` for the overview: designs, decisions, epic progress.
4. `get_ready_hexes_for_project` for the actionable queue.
5. Summarize: project statement, epic progress, and the ready hexes (id, kind, title). The user can
   watch changes land in Studio as you make them.

Read-only except for selecting a project. Never create or change hexes while orienting.
```

---

### Skill: `hexes-next-task`

```markdown
---
name: hexes-next-task
description: Pick up and execute the next ready hex, then close it out and report what it unblocked.
---

1. Pick a hex: `get_ready_hexes_for_project`. Prefer `core.bug` first, then
   `core.story`/`core.substory`, then others; within a kind, take the one that unblocks the most
   (`get_hexes_that_depend_on_hex_with_id`). A blessed `core.design` in the list is ready to be
   broken down: use `hexes-plan-work` for it. A blessed `core.spec` is approved: build the work that
   depends on it, and mark the spec `done` once that work is. A ready `core.question` needs the
   user: ask it, then answer it with their words (`update_hex_status` → `answered` with `response`),
   and report the decision it created.
2. Load context: `get_hex_view` (description, breadcrumbs, dependencies). Read the linked
   design/spec/ decision hexes with `get_hex_by_id` when the description is not self-sufficient.
3. Claim it on its own branch: `start_work_branch` (story, substory, bug, …; it also sets
   `in_progress`). Other kinds: `update_hex_status` → `in_progress`.
4. Do the work in the codebase and commit it on that branch.
5. Verify (tests, build, manual check). Then `open_pull_request` and `update_hex_status` →
   `verified`.
6. Ask the user to review the pull request. Only when they say so, `merge_pull_request`; on a
   conflict, merge main into the branch, resolve, commit and retry. Then `update_hex_status` →
   `done`.
7. Report: what changed, and which hexes became ready (`get_ready_hexes_for_project` before vs.
   after).

Rules:

- Only work on hexes that are `ready` (or blessed designs and specs). If something you need is
  blocked, surface it; do not force it.
- Never bless a design or spec, or invent an answer: these belong to a person.
- Do not mark `done` without the user's or CI's confirmation unless told you may.
- Never commit work hexes' changes straight to main, and never merge a pull request unasked.
- Work that is discovered mid-task goes in via `hexes-capture-discovery`, not into this hex's scope.
```

---

### Skill: `hexes-plan-work`

```markdown
---
name: hexes-plan-work
description: Break a goal into hexes (design → spec/decision → epic → stories → gate) with correct dependencies.
---

1. Orient (`hexes-orient`). `search_hexes` for existing hexes covering the goal — never duplicate.
2. Create top-down, capturing each returned id:
   - `core.design` (depends_on: [project_id]), left `blocked` (or `in_progress` while you draft it).
     Ask the user to bless it in Studio; you cannot. Break down only designs that are `blessed`.
   - `core.spec` / `core.decision` (depends_on: [design]); they stay `blocked` until it is blessed.
     Write each spec in full in its `description`, then ask the user to bless it too; work that
     depends on a spec stays `blocked` until they do.
   - `core.story` hexes: concrete, independently verifiable, one outcome each; `core.substory` for
     steps.
   - `core.epic` (depends_on: its design, specs, and stories).
   - `core.gate` (depends_on: its epics) for a milestone/release checkpoint.
3. Always pass `project_id`. Use `depends_on` for prerequisites and `required_by` to hook a new hex
   into an existing one (e.g. a new story required by an existing epic).
4. Statuses: leave `blocked` when there are unfinished dependencies; use `ready` only when every
   dependency is satisfied (`done`, `answered` or `blessed`; otherwise the call is refused). Hexes
   with no dependencies can be `ready`. Designs and specs are never `ready`; questions are never
   `done`.
5. Put acceptance criteria in `description`; put tooling facts (`desired_language`, `git_branch`) in
   `meta`.
6. Finish with `get_project` and show the user the resulting tree and `get_ready_hexes_for_project`.

Never create `core.pull_request` hexes: they come from `open_pull_request` when work is done.

Rules: titles are short and imperative; one hex = one atomic unit; fix wiring with `add_dependency`
/ `remove_dependency` rather than deleting and recreating.
```

---

### Skill: `hexes-capture-discovery`

```markdown
---
name: hexes-capture-discovery
description: Record a bug, question, decision or follow-up discovered while working on another hex.
---

1. Identify the hex you were working on (`current_id`) and its project.
2. `search_hexes` (query on key words, same project) to avoid duplicates.
3. `create_hex` with:
   - kind: `core.bug` (defect), `core.question` (needs an answer from the user), `core.decision`
     (choice made or needed), or `core.story` (follow-up work). A question is created open
     (`blocked` or `ready`); it is answered later with `update_hex_status` → `answered` and the
     user's `response`, which records the decision for you, so don't also create one;
   - `emerged_from: current_id`;
   - `description`: what was observed, how to reproduce, and why it matters;
   - `depends_on`/`required_by` only if it truly gates something (e.g. `add_dependency` so the
     current hex waits on a bug that blocks it). Otherwise leave it unwired.
4. If it blocks the current hex, move the current hex back to `blocked` with `update_hex_status`
   after wiring the dependency.
5. Tell the user the new id and one-line summary.
```

---

### Skill: `hexes-triage`

```markdown
---
name: hexes-triage
description: Audit the graph for stale, mis-wired or stuck hexes and propose fixes.
---

1. `get_project`, then `search_hexes` by status (`in_progress`, `blocked`, `verified`) to list each
   bucket.
2. For each `blocked` hex, `get_hexes_that_this_hex_depends_on`: flag ones whose dependencies are
   all `done` (should be ready) and ones waiting on dependencies that are themselves stuck.
3. Flag `in_progress` hexes with no `git_branch`/owner meta, and `verified` hexes awaiting `done`.
   Flag work hexes on a branch with no open pull request, and `pull_requested` pull requests that
   have waited a long time (`search_hexes` with `kind: core.pull_request`): each needs a review, a
   merge or a close.
4. Flag `core.question` hexes not yet `answered`, and `core.design` / `core.spec` hexes not yet
   `blessed` whose dependencies are all satisfied: they need a human. Flag any design or spec still
   marked `ready` (data from before blessing existed).
5. Present findings as a list with a proposed action each. Apply only what the user approves, using
   `update_hex_status`, `add_dependency`, `remove_dependency`, `update_hex`.
```

---

### Skill: `hexes-cleanup`

```markdown
---
name: hexes-cleanup
description: Delete hexes safely, with explicit user confirmation.
---

1. `get_hex_view` on the target. Show the user its title, kind, and
   `get_hexes_that_depend_on_hex_with_id` (references to it will be scrubbed from those hexes).
2. If the kind is `core.project`, warn that every hex in the project is deleted. Do not proceed
   without an explicit, specific yes.
3. Prefer non-destructive alternatives when they fit: `update_hex_status` or `remove_dependency`.
4. Only after confirmation: `delete_hex` with `confirm: true`. Never batch deletes in a loop without
   confirming the list first.
```

---

## Conventions for agents

- **Read before write.** Use `get_hex_view` / `search_hexes` before creating or changing anything.
- **Ids are opaque.** Never invent one; take it from a tool result.
- **Status is the contract.** Keep it truthful: `in_progress` when you start, `verified` when
  checked, `done` when accepted. Dependents unblock on `done`, `answered` or `blessed`.
- **Prefer small, linked hexes** over large descriptions; wire real dependencies, not hopeful ones.
- **Tell the user** the ids you touched and what changed when you finish.
