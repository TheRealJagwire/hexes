# Hexes: scaffolding prompt

Paste this, together with the Claude Design bundle, into Claude Code.

## Stack (already installed and configured in `deno.json`)

- **Deno 2.7+**: runtime, task runner, formatter, linter, test runner, `deno bundle`
- **Hono** (`jsr:@hono/hono`): HTTP server and JSON API
- **Preact 11** + `@preact/signals`: client UI (JSX via `jsxImportSource: "preact"`)
- **Tailwind CSS v4**: CSS-first config via `@theme` in `src/client/styles/app.css`; built with
  `npm:@tailwindcss/cli`
- **Strict TypeScript**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, no
  `any`
- **MCP server**: `@modelcontextprotocol/sdk` + `zod`, stdio transport (`src/mcp/server.ts`,
  registered in `.mcp.json`)
- **Zuke** (`@zuke/core`, `@zuke/deno`): build pipeline in `zuke.ts`;
  `deno task build|check|test|ci` run its targets

## Layout

```
src/server/   Hono app (app.ts) and entrypoint (main.ts); routes/ for API modules
src/client/   Preact app (main.tsx), components/, styles/app.css (Tailwind entry)
src/mcp/      MCP server (server.ts); tools/ for one file per tool
src/shared/   Types and zod schemas shared by server, client, and MCP
tests/        deno test files (*_test.ts)
design/       Unpacked Claude Design bundle (source of truth for UI)
static/       Build output served at /static (app.css, client.js)
```

## Tasks

`deno task dev | start | mcp | css | bundle | check | test`

## Your job

1. Read everything in `design/`. Extract design tokens (colors, type, spacing, radii) into `@theme`
   in `app.css`.
2. Recreate each screen and component as Preact components in `src/client/components/`, using
   Tailwind utilities only (no inline styles, no CSS modules).
3. Model the domain in `src/shared/` with zod schemas, and infer the TypeScript types from them. Use
   these for API validation and MCP tool input.
4. Expose data through Hono routes under `/api` in `src/server/routes/`.
5. Expose the same capabilities as MCP tools in `src/mcp/tools/`, one file per tool, reusing shared
   schemas and server logic.
6. Add a `deno test` test for each route and tool.

## Rules

- `deno task check` and `deno task test` must pass before you finish.
- No `any`, no `@ts-ignore`, no non-null `!` assertions. Narrow instead.
- Pin nothing to old versions; use the import map in `deno.json` for all dependencies.
- Keep the MCP server stdio-clean: never write to stdout except via the transport (log to stderr).
- Ask before adding dependencies not listed here.
