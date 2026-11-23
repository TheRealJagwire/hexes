# Hexes Studio

Track a project as **hexes**: atomic tracked things (project, design, spec, decision, gate, epic,
story, substory, bug, fact…) stored per project in `~/.hx/projects/<id>/data.json` (see
[Where hexes live](#where-hexes-live)). Studio is the UI; an MCP server exposes the same actions to
agents. See `design/SPEC.md` for the product spec and `questions.md` for the decisions made along
the way.

Stack: Deno 2, Hono, Preact 11 + signals, Tailwind CSS 4, strict TypeScript, MCP SDK + zod, and
[Zuke](https://jsr.io/@zuke/core) for the build.

## Run it

```sh
deno task build   # Tailwind + client bundle into static/ (a Zuke target)
deno task start   # http://127.0.0.1:8000
deno task seed    # optional: a sample project in examples/sample
deno task dev     # watch CSS, client and server
```

## Statuses

Each kind has its own lifecycle (`KIND_WORKFLOWS` in `src/shared/constants.ts`, served at
`GET /api/statuses`). Work (stories, substories, bugs and custom kinds) goes `blocked` → `ready` →
`in_progress` → `in_review` → `merged`, following its pull requests (below); `done` is for work that
never had a branch. Projects, epics, gates and decisions go `blocked` → `ready` → `in_progress` →
`verified` → `done`. Designs and specs are `blessed` instead of `ready`: a person has approved them,
and that unblocks what depends on them (a design's specs and decisions, a spec's stories). A
question is `answered` instead of `done`: answering needs a response, which is recorded as a new
decision hex. Data from before these workflows is migrated the first time a workspace is opened.

Ideas (`core.idea`) are where work starts, and they belong to people. Someone writes one in Studio
or the app as a `draft`, then sets it `published` when they want it designed; it goes back to
`draft` or on to `done` only when they say so. Agents can read ideas and build on them, but every
MCP write to an idea is refused, and so are `draft` and `published` on any hex. An idea has no
`blocked`, so it never waits on its project: a published idea is always ready to be designed.
Publishing one wakes the agent (below), which writes a design that depends on the idea and stops
there until you bless it.

## Facts

A fact (`core.fact`) is one short, durable statement that holds true about the project: "Channels
must be stdio", "A gate depends on its epics". Facts build up into a knowledge base in the same
graph as the work, so an agent starting a hex can fetch what is already known around it instead of
rereading designs and code.

- **The title is the fact**: one sentence, about 140 characters. The description is optional and
  holds the evidence: files, commits, docs, or the hex it came from.
- **Links say what it is about.** A fact depends on its project and on every hex it concerns (a
  design, decision, story, another fact); `emergedFrom` is the hex being worked on when it was
  learned. Optional `meta.files` lists the repo paths it concerns, comma-separated.
- **Two statuses.** A fact is created `known`; set it `retired` when it no longer holds, which keeps
  the record. When a new fact replaces an old one, the new fact depends on the old one and the old
  one gets `meta.superseded_by`. A retired fact can be restored to `known`.
- **Not work.** A fact never waits on what it is about, never shows as ready, never gets a branch,
  never wakes the agent, and nothing should depend on it as a prerequisite.

A good fact is durable and non-obvious: a constraint, a gotcha or a convention the next session
would otherwise have to rediscover. Don't restate what a design or spec already says, and record one
fact per hex, never a list. People and agents both write facts. In Studio, pick `core.fact` in the
create form ("Statement", with an "About" picker); the project page has a Facts group with retired
ones behind a toggle, every hex page lists the facts about it, and a fact's page has Retire and
Restore.

`GET /api/projects/:id/facts` (MCP `get_facts`) returns the project's `known` facts, newest first.
`near=<hex id>` keeps those within `depth` links of that hex (default 2, at most 4), followed in
both directions but never through the project, ordered by distance and each with the path that
reached it. `file=<repo path>` keeps facts whose `meta.files` lists it, `query=` matches titles as
hex search does, and `include_retired=1` adds retired facts. Filters combine.

## Where hexes live

Each project has its own folder outside any repository (schema version 2):

```
~/.hx/projects/<project-id>/
  data.json          the project hex and every hex of that project
  diffs/<pr>.patch   what each merged pull request changed, kept in case the commits disappear
  channels/          one file per listening hexes-channel process
```

`HEXES_HOME` moves the `~/.hx` root (tests use it). The project hex records where its code lives and
which layout it uses in its meta: `repo_path` (the git working tree that branches, pull requests and
merges run in) and `schema_version` (`"2"`). Creating a project writes this folder and sets
`repo_path` to the folder you chose; the only thing written into the repository is
`.hx/project.json` (below).

**Browse…** next to a folder field opens a native folder dialog on the machine the server runs on:
on macOS, on Windows, and inside WSL (the Windows dialog, its path converted with `wslpath`, so
`C:\code\app` is stored as `/mnt/c/code/app`). Elsewhere, type the path. The same folder can end up
stored under a Windows and a WSL spelling; each server keeps the one it can open.

Older projects (schema version 1) kept their hexes in the repository, in `<repo>/.hx/data.json`,
several projects to a file. Studio no longer opens them in place: the welcome screen's **Move an
older project** takes such a folder and migrates it, splitting the file into one folder per project
(with `repo_path` set to that repository and its saved diffs copied over), then opens the moved
project. Migration is all or nothing: it stops before writing if a target folder already exists or
another project already uses the same id prefix, removes what it wrote if anything fails, and only
then renames the old file to `<repo>/.hx/data.json.migrated-v1`, which stays as a backup for you to
delete. Only a person migrates: agents have no tool for it. `HEXES_DIR` pins Studio to one v1 folder
(tests and old setups); while it is set, the `~/.hx` projects are not used and migration is refused.

## Which project a repository belongs to

A repository names its project in `.hx/project.json`, committed with the code:

```json
{ "project_id": "hx-hexes-f1a" }
```

Creating a project with a folder, giving one a repository (forking a seed or picking a folder), and
Studio's startup (for projects that had a repository before the file existed) all write it; moving a
project to another folder removes the old folder's file, and a folder that already names another
project is refused. Agents read it from their working directory, or call `find_project`, and pass
that id on every call; `hexes-channel` reads it to know which project to report on. Nothing in Hexes
is "selected": opening a project in Studio never changes what an agent or channel works on, so two
sessions in two repositories work side by side. Calls that take only a hex id find its project from
the id's prefix (`hx-<prefix>-…`), which is why no two projects share a prefix.

Commit the file. The rest of `.hx/` stays out of git, and a `.gitignore` line that hid the whole
folder (`.hx/`) can't let one file back in, so Hexes rewrites it as:

```gitignore
.hx/*
!.hx/project.json
```

## Repository seeds

A **seed** (`core.seed`) is a git repository that new projects can be forked from: a starter app, a
template, a previous project worth reusing. Seeds belong to no project; every project on the machine
shares them, in `~/.hx/seeds/data.json` (ids `hx-seed-…`). Manage them on Studio's **Repository
seeds** screen (from the projects list) or with the `list_seeds`, `create_seed`, `update_seed` and
`retire_seed` tools. A seed is `available` until retired.

Each seed holds a title, `meta.git_url` (anything `git clone` accepts, a remote URL or a local
path), `meta.branch` (default `main`) and a **short** description: about five lines on the stack,
what works out of the box, and what it is a good and a poor fit for, so you or an agent can tell at
a glance whether it suits a project. Past 600 characters Studio and the tools flag it.

A project can be created without a folder. Until it has a repository, its stories and bugs are left
out of the ready lists, branch work is refused, and each epic shows "waiting for a repository"; its
designs, specs and questions stay workable, so it can be planned first. The project page then offers
two ways to give it one (MCP `set_project_repo`, REST `PUT /api/projects/:id/repo`):

- **Fork a seed** into a new or empty folder: Hexes clones the seed's branch, renames its `origin`
  remote to `seed` (so nothing is pushed back to the seed; add your own remote when you want one),
  and records the seed in the project's `meta.repo_ref_hx`.
- **Use an existing folder** that is already a git repository.

Either sets `meta.repo_path`. A folder can be one project's repository only. Older (v1) projects
always have a repository, their folder.

## Per-user state

Studio remembers, per user, only the recently opened projects (`recentProjects`: project id, title
and when; newest first, at most 10). Opening a project puts it first; that is all it does. They live
in `~/.config/hexes/state.json` (under `$XDG_CONFIG_HOME` when set; `HEXES_STATE_FILE` overrides the
path), never in a project's repository; keys from older versions (`selectedProjectId`, `lastDir`,
`recent`) are dropped the next time it is written. `/` opens the projects list.

## Branches and pull requests

Work hexes (stories, bugs, …) are built on their own branch and reach main through a pull request.
Studio's "Branch & pull requests" panel, the app and the MCP tools all drive the same steps: start
work (Hexes creates `hx/<id>-<slug>` off main and switches to it), commit, open a pull request (a
`core.pull_request` hex the work then waits on), and merge it with a merge commit. The work hex's
own status shows where it stands: opening a pull request makes it `in_review`, merging makes it
`merged` (and unblocks what waits on it), and closing an unmerged one puts it back to `in_progress`.
Only pull requests set `in_review` and `merged`; the status menus don't offer them, and a hex with a
branch can't be marked `done` by hand. Each epic on the project page counts its stories in review.
Hexes runs git in the project's repository (its `repo_path`; for a v1 project, the folder holding
`.hx/`, which must then be in `.gitignore`), and uncommitted changes block a switch. Merging never
switches branches: a branch that is checked out is merged in place (and must be clean), any other
without touching a working tree. Other open pull requests don't need updating after a merge; only
those that now conflict with main are flagged, and "Update from main" merges main into a pull
request's branch the same switch-free way. After a merge, the work hex links to a diff view of what
landed; the diff is also saved in the project's `diffs/` folder (for a v1 project, `.hx/diffs/`) in
case the commits disappear.

## Auto-merge

Each project has an **auto-merge** switch, on by default and shown just under the project statement
so you don't forget it. While it's on, Studio does the git workflow itself: opening a pull request
merges it into main straight away (so the work becomes `merged` and what waits on it unblocks), then
merges main into the project's other outstanding branches, those of open pull requests and of
unfinished work that has no pull request yet. Nothing is forced and no branch is switched: a branch
that would conflict is left as it is with the conflict recorded (`meta.merge_conflicts`), a branch
checked out with uncommitted changes is skipped, and if the new pull request itself conflicts it
simply stays open. `meta.auto_merge_result` on the pull request says what happened. Turn it off to
review and merge pull requests yourself as before; turning it back on doesn't merge the ones already
open.

The setting is `meta.auto_merge` on the project hex (`"off"` turns it off), `autoMerge` in the
project and hex views, and `PUT /api/projects/:id/auto-merge` with `{ "enabled": true | false }`.
It's a person's choice: agents can read it but the MCP tools refuse to change it.

## Hex search

Every page inside a project has a search box in its header; press `/` to jump to it. Suggestions
appear as you type: a hex matches when each word you type is the start of a word in its title ("hex
ma" finds "Design a hex map of the whole project"), or when you type the start of its id, with or
without the project part ("0c5" or "hx-hexes-0c5"). An exact id comes first, then titles that start
with what you typed, then titles whose matching words come earliest; ties go to unfinished, then
recently updated hexes (`searchHexes` in `src/shared/search.ts`). Use ↑/↓ and Enter, or click, to
open one; Esc closes the list, then clears the box.

## Hex map

**Hex map** on a project's page (`/p/:id/map`) shows every hex in the project as a cell on a
hexagonal grid. A cell's colour is its status, the same as the status pills, and its label is its
kind (I idea, P project, D design, Sp spec, Dec decision, Q question, F fact, E epic, St story, Sub
substory, B bug, G gate, PR pull request). Hover or focus a cell for its details and to highlight
the hexes it links to; click it, or press Enter, to open it. Drag to pan, scroll or pinch to zoom,
and **Fit** frames the whole map.

The project sits in the centre and every other hex goes in the free cell closest to the hexes it
links to, so related hexes cluster together (`hexLayout` in `src/shared/hexmap.ts`). The layout is
the same every time. The map reads `GET /api/projects/:id/graph`: the project's hexes, project
first, and the dependency links between them.

## MCP server

Studio serves MCP itself over streamable HTTP at `http://localhost:8000/mcp`, sharing one service
with the UI, and `.mcp.json` points Claude Code at it (start Studio first). Every call names its
project (see `.hx/project.json` above), or the folder pinned by `HEXES_DIR` if set. The stdio entry
(`deno task mcp`) still exists for clients that need a spawned process.

## Waking the agent

Publishing an idea, blessing a design or spec, or answering a question, unblocks work.
`hexes-channel` tells a waiting Claude Code session about it, so the agent picks the work up without
you typing "please continue". It is a one-way
[Claude Code channel](https://code.claude.com/docs/en/channels-reference): a small stdio MCP server
(`src/mcp/channel.ts`, `deno task channel`) with no tools. It watches the active workspace, like
Studio does, and doesn't need Studio running.

After changes settle (1.5 s), it sends one event per project that names what was published, blessed
or answered and what became ready:

```
Blessed: spec hx-hexes-775 "Spec the hexes-channel events and server"
Now ready: hx-hexes-1a4 (story) "Detect unblocking transitions between two snapshots"
```

```
Published: idea hx-hexes-3c2 "Let people write ideas"
Now ready: none yet
```

For a published idea the agent runs `hexes-plan-work` to write one design that depends on the
project and the idea, asks you to bless it, and stops. It breaks down a blessed design with
`hexes-plan-work`, and starts the newly ready hexes of a blessed spec or answered question with
`hexes-next-task`. Publishing an idea again after a trip back to `draft` sends a new event. It
finishes its current step first and still leaves merging to you. Changes that only move readiness,
like an agent finishing a story, send nothing. Nothing is replayed when the channel starts.

`.mcp.json` registers it. Channels are a Claude Code research preview and custom channels aren't on
its allowlist, so opt in per session with the development flag:

```sh
claude --dangerously-load-development-channels server:hexes-channel
```

A plain `claude` start doesn't load it, and the events are simply dropped. Every session that loads
the channel gets every event, so run one per working tree: branches are shared anyway.

## Remote access (phone)

By default Studio listens on `127.0.0.1` only. To reach it from the Android app, bind a wider
address and set a token (16+ characters); Studio refuses to start otherwise:

```
HOST=0.0.0.0 HEXES_TOKEN=<secret> HEXES_PUBLIC_URL=http://<tailscale-name>:8000 deno task start
```

It prints a QR code and URL for pairing. Remote clients (anything not on loopback) must send
`Authorization: Bearer <token>` to `/api` and `/mcp`; the local browser still needs none.
`HEXES_ALLOWED_HOSTS` optionally restricts the Host header. Use a private network such as Tailscale:
the connection is plain HTTP unless you terminate TLS in front of it.

API contract: responses carry `X-Hexes-Api: 1`, and golden responses in
`android/app/src/test/resources/contract/` are checked by `tests/contract_test.ts` (refresh with
`UPDATE_CONTRACT=1`). `PATCH /api/hexes/:id` accepts `expectedUpdatedAtTimeInMs` and answers 409
when the hex changed since the client last read it.

## Android app

`android/` holds a thin client of the API above (Kotlin, Compose). Build and test with
`deno task zuke androidTest` and `deno run -A zuke.ts androidBuild` (debug APK); both find Android
Studio's JDK and the SDK. Pair with the `hexes://pair?url=…&token=…` link Studio prints, or type the
address; for an emulator or USB phone run `adb reverse tcp:8000 tcp:8000` and use `localhost:8000`.

`deno run -A zuke.ts androidRelease` builds a signed, minified APK at
`android/app/build/outputs/apk/release/app-release.apk` to sideload. Signing reads
`android/keystore.properties` (gitignored: `storeFile`, `storePassword`, `keyAlias`, `keyPassword`);
without it the release APK is unsigned. Create a key once with
`keytool
-genkeypair -keystore ~/.hexes/hexes-release.jks -alias hexes -keyalg RSA -keysize 4096
-validity 10000`,
and back it up: an update must be signed with the same key to install over the old one.

## Layout

```
src/shared/   zod schemas, constants and the pure graph logic (ready, progress, breadcrumbs)
src/server/   core/ (store, workspace, HexService, migrate_v2), routes/ (Hono API), guard.ts, app.ts
src/mcp/      tool definitions (tools/), the stdio entry and hexes-channel
src/client/   Preact app: screens/, components/, lib/, styles/app.css (theme tokens)
tests/        deno test
scripts/      seed.ts
zuke.ts       the build (Zuke targets)
design/       the Claude Design handoff
```

## Build (Zuke)

The build is `zuke.ts`: targets are class fields wired by reference. `deno task <name>` runs the
matching target.

```sh
deno task zuke --list   # every target with its dependencies
deno task ci            # check (fmt, lint, typecheck) + test + build
deno task zuke clean    # delete generated assets
```

`css` and `bundle` are incremental: Zuke fingerprints their inputs and skips them when nothing
changed (state lives in the git-ignored `.zuke/`; pass `--no-cache` to force). The watch tasks
(`dev`, `css:watch`, `bundle:watch`) stay plain `deno task` commands.
