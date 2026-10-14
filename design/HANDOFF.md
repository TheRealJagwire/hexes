# Hexes Studio — design handoff

**Read `SPEC.md` first.** It's the original product spec: the hex data model, kind conventions and
dependency direction, the "ready" rule, every Studio flow, and the MCP server tools. SPEC.md is the
source of truth for behaviour, and this file covers the visual design. If the two disagree, follow
SPEC.md and flag the conflict.

These are the design comps for Hexes Studio. Each `screens/*.dc.html` file holds the markup for one
screen, with inline styles. A `<script data-dc-script>` block at the bottom of each file holds its
sample data and interaction logic as a plain JS class.

The comps are a visual and behavioural reference only. Don't run them as-is: rebuild them as real
components in the app's stack.

## How to read the files

- `{{name}}` is a value returned from `renderVals()` / `baseVals()` in that file's script.
- `<sc-for list="{{items}}" as="item">` repeats its contents once per item.
- `<sc-if value="{{flag}}">` renders its contents only when the flag is true.
- `onClick="{{fn}}"` is a click handler returned from the script.
- `<a href="X.dc.html">` means "navigate to screen X".

## Screens

| File              | Screen            | Key behaviour                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main.dc.html      | First run         | Two paths: open a folder that has `.hx/data.json`, or create a new project (location, title, statement, git init).                                                                                                                                                                                                                                      |
| Projects.dc.html  | Project list      | Shown when there's no `studio.selected_project` hex. Rows list projects from data.json, and the list has a filter.                                                                                                                                                                                                                                      |
| Project.dc.html   | Project screen    | Project statement hero (kind, id, copy button). Collapsed Designs and Decisions accordions. Epics are top-level accordions with a progress ring, % and done/total, counting only the stories the epic depends on. Inside an epic, stories are sorted in_progress → verified → ready → blocked → done. Expanding a story shows its description and meta. |
| Hex.dc.html       | Hex screen        | Breadcrumbs follow the dependency trail up the tree (project › gate › epic). Status dropdown. Fields and meta table. Panels for "Depends on" and "Depended on by". Two-step delete: Delete… → Continue → Delete forever.                                                                                                                                |
| CreateHex.dc.html | Create hex dialog | Kind chips (`core.*`) or a custom kind. Title, description, status (defaults to `blocked`), emergedFrom. "Required by" adds this hex to other hexes' dependsOn. "Depends on". Meta key/value rows. The id is hashed on save.                                                                                                                            |

## Theme tokens

Every colour is a CSS custom property on `.hx-root`. Adding `.light` to the root switches the theme.
The light/dark choice persists in `localStorage['hexes-theme']`.

| Token              | Dark                | Light             |
| ------------------ | ------------------- | ----------------- |
| --bg               | #121418             | #F6F5F2           |
| --backdrop         | #0C0D10             | #E4E2DD           |
| --panel            | #1A1D22             | #FFFFFF           |
| --panel2           | #20242A             | #F0EEEA           |
| --line-soft        | #262A31             | #ECEAE5           |
| --line             | #2C313A             | #E0DDD7           |
| --line-strong      | #3A404B             | #CFCBC4           |
| --line-hover       | #4A515D             | #B5B0A8           |
| --text             | #ECEAE4             | #1B1D21           |
| --text-2           | #C9CDD3             | #3D424A           |
| --muted            | #A3A9B3             | #5F656E           |
| --placeholder      | #7D838D             | #8A8F97           |
| --accent           | #F2B13C             | #96620A           |
| --accent-hover     | #FFD07A             | #7A4F06           |
| --on-accent        | #1A1405             | #FFFFFF           |
| --accent-bg        | #362A12             | #FBEFD6           |
| --ready / -bg      | #8EC1FF / #1C2A3D   | #1F5FB8 / #E3EEFC |
| --verified / -bg   | #6FD3C0 / #143330   | #0F7363 / #DDF3EE |
| --blocked / -bg    | #FF9A7A / #3A1F18   | #B23A17 / #FBE5DD |
| --success          | #6FD3A8             | #1E7A4F           |
| --danger-line      | #5A2A24             | #E8B4A8           |
| danger fill (both) | #B3261E, white text |                   |

Status pills: in_progress uses the accent colour, and done uses muted text on line-soft.

## Type and shape

- Fonts: IBM Plex Sans (400/500/600/700) for UI text, and JetBrains Mono for hex ids, kinds and
  meta.
- Corner radii: 16px for hero cards, 12–14px for cards, 8–10px for inputs and buttons, and 999px for
  pills.
- Touch targets are at least 44px tall.
- Page content is capped at 1040px wide with 32px side padding. Rows wrap at narrow widths.

## Hex shape (from the spec)

`id` (`hx-<prefix>-<3 hex chars>`, hashed from title + kind + createdAtTimeInMs), `title`,
`description`, `kind` (`<namespace>.<qualifier>`), `createdAtTimeInMs`, `lastUpdatedAtTimeInMs`,
`status` (ready | in_progress | verified | blocked | done; defaults to blocked), optional
`dependsOn[]`, `emergedFrom`, and `meta` (a string → string map).

Open question: the 3-character hash allows only 4,096 ids per prefix, so the app needs a collision
strategy.
