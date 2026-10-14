# Hexes Studio

Track a project as **hexes**: atomic tracked things (project, design, spec, decision, gate, epic,
story, substory, bug…) stored in `.hx/data.json`. Studio is the UI; an MCP server exposes the same
actions to agents. See `design/SPEC.md` for the product spec and `questions.md` for the decisions
made along the way.

Stack: Deno 2, Hono, Preact 11 + signals, Tailwind CSS 4, strict TypeScript, MCP SDK + zod.

## Run it

```sh
deno task build   # Tailwind + client bundle into static/
deno task start   # http://127.0.0.1:8000
deno task seed    # optional: a sample project in examples/sample
deno task dev     # watch CSS, client and server
```

## MCP server

`.mcp.json` registers it for Claude Code (`deno task mcp`, stdio). It works on the folder last
opened in Studio, or on `HEXES_DIR` if set.

## Layout

```
src/shared/   zod schemas, constants and the pure graph logic (ready, progress, breadcrumbs)
src/server/   core/ (store, workspace, HexService), routes/ (Hono API), guard.ts, app.ts
src/mcp/      tool definitions (tools/) and the stdio entry
src/client/   Preact app: screens/, components/, lib/, styles/app.css (theme tokens)
tests/        deno test
scripts/      seed.ts
design/       the Claude Design handoff
```

`deno task check` runs fmt, lint and type checks; `deno task test` runs the tests.
