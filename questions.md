# Open questions and guesses

I made a best guess for each of these and kept going. Each item says what I assumed and what to
change if I guessed wrong. Roughly ordered by how much it affects the rest of the app.

## Blocking-ish

1. **zuke (resolved).** It is `@zuke/core` and `@zuke/deno` on JSR, now integrated: see item 26.

## Data model

2. **Shape of `.hx/data.json`.** SPEC says "a data.json file of hex objects", so I wrote a plain
   JSON array of hexes with no wrapper object. A wrapper (`{ "version": 1, "hexes": [] }`) would
   allow migrations later, but costs a format change now.
3. **How a hex belongs to a project.** SPEC says gates depend on epics and designs depend on
   projects, but never says how a gate is tied to a project. Making the project depend on its gates
   would create a cycle (project → gate → epic → design → project). So **membership is by id
   prefix**: every hex in a project shares `hx-<prefix>-…`, matching the sample ids in the design
   (`hx-studio-…`). Consequences: two projects can't share a prefix (a numeric suffix is added), and
   hexes can't move between projects.
4. **Where the prefix comes from.** The design shows `hx-studio-`, `hx-docs-`, `hx-import-` for
   "Hexes Studio", "Docs site", "Markdown importer", which follows no single rule. I use the first
   meaningful word of the title, max 8 chars, lowercased (`Hexes Studio` → `hexes`). There is no
   field for choosing the prefix. Say if you want one on the create-project form.
5. **Breadcrumb parents.** Trail = project › gate › epic › story › substory. A story's parent is the
   epic that depends on it, an epic's parent is the gate that depends on it, a gate's parent is the
   project by prefix. Specs and decisions use the design they depend on; designs and bugs use the
   project. Anything missing falls back to the project. If a hex has several candidate parents I
   take the earliest created.
6. **Id collisions** (the design's open question). Ids start with 3 hex chars (4,096 per prefix).
   When a new id collides with an existing hex, the _new_ hex's hash grows one digit at a time
   (`hx-foo-d4d` → `hx-foo-d4d1` → …) until it is free; the older hex keeps its id and `createdAt`
   is never changed. Every id is therefore a prefix of the sha-256 of the stored title, kind and
   createdAt. The id format is now `hx-<prefix>-<3 or more hex chars>`. Note a longer id always
   _starts with_ the colliding shorter one.
7. **Status of the project hex and `studio.selected_project`.** SPEC defaults status to `blocked`,
   but designs depend on the project, so a `blocked` project would keep every design blocked. I
   create both as `done`.

## Behaviour

8. **What "ready" means.** A hex is _ready_ when its status is `ready` and every dependency is
   `done`. `get_ready_hexes` returns exactly those. I also keep status honest automatically:
   - a `blocked` hex whose dependencies all become `done` is promoted to `ready`;
   - a `ready` hex that gains or loses a finished dependency drops back to `blocked`;
   - only hexes whose dependencies just changed are touched, so a hex you blocked by hand is never
     promoted by an unrelated edit.
9. **Setting `ready` by hand is refused** (409) while any dependency isn't `done`, per SPEC ("must
   have the status of done before set to ready"). Other statuses are never refused. The design's
   sample data breaks this rule in places (e.g. an `in_progress` story depending on a `verified`
   spec); I followed SPEC.
10. **Dependency cycles are rejected** on create and on adding a dependency.
11. **Deleting a project deletes every hex in it** (everything sharing its prefix) and says so in
    the confirmation step. Deleting any other hex scrubs it from other hexes' `dependsOn` /
    `emergedFrom` instead of deleting them. The alternative (refuse to delete a project that still
    has hexes) felt worse.
12. **Selected project.** Stored in a singleton hex of kind `studio.selected_project` whose
    description is the project's id (prefix `studio`). Opening any project screen re-selects it, so
    Studio reopens there. `/` goes: no folder → Welcome, selected project → its screen, else the
    list. The design's "Open project folder" button went straight to the project list; mine goes
    through `/` so a previously selected project wins, as SPEC's "Existing Sessions UX" asks.
13. **Create Hex cannot create `core.project`.** The design lists that chip, but a second project
    hex in the same prefix would break rule 3. I left the chip out. Projects come from the Welcome
    screen. A custom kind still works for anything else.

## Architecture and safety

14. **Which folder is open.** The last opened/created folder is remembered in
    `~/.config/hexes/state.json` (`XDG_CONFIG_HOME` respected, `HEXES_STATE_FILE` overrides). Studio
    and the MCP server both read it, so opening a folder in Studio retargets MCP. Set `HEXES_DIR` to
    pin one directory instead (then "open" is refused). **`deno task seed` writes that state file
    too**, so it points Studio at `examples/sample`.
15. **Studio listens on 127.0.0.1 only**, and the API refuses non-loopback `Host` headers,
    cross-origin writes and non-JSON bodies. The API can read and write folders on your machine, so
    I didn't want any web page able to reach it.
16. **"Browse…" uses macOS `osascript`** (a native folder chooser). On other systems it returns an
    error telling the user to type the path.
17. **Concurrent writers.** Every operation re-reads the file, writes to a temp file and renames it
    over the original, with a lock inside one process. Studio and the MCP server are separate
    processes with no cross-process lock, so two writes within milliseconds could lose one. Fine for
    one person; say if you want file locking.
18. **Routing.** Plain History-API router, no dependency. Routes: `/`, `/welcome`, `/projects`,
    `/p/:id`, `/p/:id/new?emergedFrom=…`, `/h/:id`. The Create Hex dialog is a route, not a modal
    over the previous screen.

## MCP

19. **Tool names.** The ones SPEC names are spelled exactly as given (`get_hex_by_id`,
    `get_ready_hexes`, `get_ready_hexes_for_project`, `get_hexes_that_depend_on_hex_with_id`,
    `get_hexes_that_this_hex_depends_on`, `add_meta_state_to_hex_with_id`,
    `update_meta_state_to_hex_with_id`). I added the rest of the Studio actions (`create_project`,
    `list_projects`, `select_project`, `get_project`, `get_hex_view`, `create_hex`, `update_hex`,
    `update_hex_status`, `delete_hex`, `add_dependency`, …). `add_meta…` fails if the key exists and
    `update_meta…` fails if it doesn't. I added `remove_meta_state_from_hex_with_id`.
20. **`delete_hex` needs `confirm: true`**, mirroring Studio's double confirmation.

## Beyond the design

21. I added a few things the comps didn't show: editing a hex's title and description, removing meta
    keys, a loading state and an error state on every screen, and an empty state for projects with
    no epics.
22. Meta: "Add key" on the Hex screen saves immediately (and overwrites an existing key of the same
    name); there is no inline edit of an existing value yet.

## Zuke

26. **How Zuke is used.** `zuke.ts` holds the targets (`clean`, `css`, `bundle`, `build`, `fmt`,
    `lint`, `typecheck`, `check`, `test`, `ci`) and the `build`, `css`, `bundle`, `check`, `test`
    and `ci` tasks in `deno.json` now call it. I left the watch tasks and `dev`/`start`/`mcp`/`seed`
    as plain tasks. I did **not** add `cicd(...)`, which would generate a GitHub Actions workflow on
    every run; say if you want CI generated.
27. **`zuke.ts` needs network on first run** to fetch `@zuke/core` / `@zuke/deno` from JSR. I didn't
    install the `zuke` CLI or its `./zuke` launcher; `deno run -A zuke.ts` does the job.

## Not verified

23. I checked the screens visually in dark mode only, at desktop width, via headless Chrome
    screenshots. **Light mode and phone widths are untested**, and no interaction was driven in a
    real browser (clicks, the delete flow, the create form). The API, domain logic and MCP tools do
    have tests (17 passing). There are no client component tests.
24. `deno bundle` is flagged experimental by Deno. The client is built with it because it needs no
    extra dependency; esbuild would be the fallback.
25. Fonts load from Google Fonts, as in the comps, so the UI needs a network connection to look
    right.
