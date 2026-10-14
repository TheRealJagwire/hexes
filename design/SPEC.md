Hexes - a project state tracking system consisting of "hexes", individual atomic tracked things that
can be used to index any arbitrary piece of data, such as project descriptions, visions, elements of
a PRD, epics, stories, bugs, sessions, etc...

Hex - a single tracked state of something. Each Hex has:

- id of the format: hx-<some-prefix>-<3-digit-hex-hash> e.g. hx-foobar-d4d The hash is calculated
  from the hex's title, kind, createdAtTimeInMs values.
- title: "do a thing", "things to be done", "
- description/value: "detail on how to do the thing, a value being tracked, or otherwise stored
  state"
- kind: a namespaced "tag" via string of the format <category>.<qualifier>, such as "core.project",
  "core.epic", "core.story", etc...
- createdAtTimeInMs: timestamp in milliseconds
- lastUpdatedAtTimeInMs: timestamp in milliseconds
- status: a string of one of the following values "ready, in_progress, verified, blocked, done.",
  defaulted to "blocked".
- optional dependsOn: a collection of hex identifiers that must have the status of "done" before set
  to ready.
- optional emergedFrom: a hex identifier that was being worked on that discovered this hex.
- optional meta: a map of key-value-pairs, string to string ** Example meta mappings could be: ***
  git directory: ./ | ... *** git branch: main | ... *** git worktree: ... *** github_url: ... ***
  desired_language: typescript | C++ | kotlin | python | ruby etc... *** desired_spec: <hex_id> ***
  files_to_touch: file1, file2, file3 depends on context

Starting kind namespace: core Starting core kind values: project, design, spec, decision, gate,
epic, story, substory, bug, Starting conventions, projects have designs, gates, and bugs, designs
have decisions and specs, gates have epics, epics have stories, stories can have zero or more
substories, in that direction, so the optional dependsOn fields for these types flow in that
direction. Epics depend on the most: designs, specs, and stories. Designs depend on projects, specs
depend on designs, gates depend on epics. Hexes are considered "ready" when all their dependencies
are in "done" status. Other namespaces: studio Example values: selected_project

Studio - a UI/UX solution for working with Hexes.

- First time UX:
-
  - a user is prompted to either open an existing directory with a .hx directory containing a
    data.json file of hex objects or
-
  - create a new project and select a directory to put it in, creating a git repo and a prompt to
    enter text for a project hex

- Existing Sessions UX:
-
  - A user should see their previously selected project if one exists in their .hx/data.json.
-
  - If no selected_project hex exists, A user is shown a list of project titles, populated from a
    .hx/data.json file.
-
  - Clicking on any project enty shows a project screen, populated by project hex

- Project Screens
-
  - The user should see a hero object with the title and description/value of the project statement.
-
  - The user should see the hex identifier of the project statement
-
  - Below the project statement, the user should see a collapsed accordion UI element of designs,
    decisions, and epics
-
  - Expanding designs, shows an accordion of design hex objects
-
  - Expanding decisions, show an accordion of decision hex objects
-
  - Epics should be top-level accordion objects. The user should be able to see the hex id, title,
    and percentage of done tickets that the epic depends on with a circular progress bar, percentage
    text, and fraction of done dependencies
-
  - Expanding an epic accordion element should show all the story hexes that epic hex depends on.
    The "done" stories should be sorted to the bottom of this collection.
-
  - Clicking to expand a story shows it's description and other fields in its meta map
-
  - There is a "Create Hex" button somewhere that makes sense where a user can create a new hex,
    select its type, enter a title and a description along with any other optional fields.

-
  - Hex Screen
-
  - Viewing an individual hex shows a uniform screen with all information.
-
  - The user can manually update the status from a dropdown
-
  - The user can delete the hex by tapping a delete button and going throw a double confirm flow.
-
  - The user should be able to see a trail of breadcrumbs depicting the dependency tree. e.g.
    breadcrumbs of a story hex should show project_title > gate_title > epic_title . Clicking on any
    breadcrumb should navigate to the hex being referenced by that breadcrumb

-
  - MCP Server
- All actions a user can take in Studio can be exposed as tools via MCP server
- Additional tool callouts:
-
  - get_hex_by_id (id)
-
  - get_ready_hexes(), get_ready_hexes_for_project()
-
  - get_hexes_that_depend_on_hex_with_id(id)
-
  - get_hexes_that_this_hex_depends_on(id)
-
  - add_meta_state_to_hex_with_id(id, key, value);
-
  - update_meta_state_to_hex_with_id(id, key, value);
