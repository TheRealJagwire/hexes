# Hexes Studio

Track a project as **hexes**: atomic tracked things (project, design, spec, decision, gate, epic,
story, substory, bug…) stored in `.hx/data.json`. Studio is the UI; an MCP server exposes the same
actions to agents. See `design/SPEC.md` for the product spec and `questions.md` for the decisions
made along the way.

Stack: Deno 2, Hono, Preact 11 + signals, Tailwind CSS 4, strict TypeScript, MCP SDK + zod, and
[Zuke](https://jsr.io/@zuke/core) for the build.

## Run it

```sh
deno task build   # Tailwind + client bundle into static/ (a Zuke target)
deno task start   # http://127.0.0.1:8000
deno task seed    # optional: a sample project in examples/sample
deno task dev     # watch CSS, client and server
```

## MCP server

Studio serves MCP itself over streamable HTTP at `http://localhost:8000/mcp`, sharing one
service with the UI, and `.mcp.json` points Claude Code at it (start Studio first). It works on
the folder last opened in Studio, or on `HEXES_DIR` if set. The stdio entry (`deno task mcp`)
still exists for clients that need a spawned process.

## Layout

```
src/shared/   zod schemas, constants and the pure graph logic (ready, progress, breadcrumbs)
src/server/   core/ (store, workspace, HexService), routes/ (Hono API), guard.ts, app.ts
src/mcp/      tool definitions (tools/) and the stdio entry
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
