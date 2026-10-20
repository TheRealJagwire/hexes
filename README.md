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

## Statuses

Each kind has its own lifecycle (`KIND_WORKFLOWS` in `src/shared/constants.ts`, served at
`GET /api/statuses`). Most go `blocked` → `ready` → `in_progress` → `verified` → `done`. A design is
`blessed` instead of `ready`: a person has approved it for breaking down, and that unblocks its
specs and decisions. A question is `answered` instead of `done`: answering needs a response, which
is recorded as a new decision hex. Data from before these workflows is migrated the first time a
workspace is opened.

## Branches and pull requests

Work hexes (stories, bugs, …) are built on their own branch and reach main through a pull request.
Studio's "Branch & pull requests" panel, the app and the MCP tools all drive the same steps: start
work (Hexes creates `hx/<id>-<slug>` off main and switches to it), commit, open a pull request (a
`core.pull_request` hex the work then waits on), and merge it with a merge commit. Hexes runs git in
the project's own working tree, so `.hx/` must be in `.gitignore` and uncommitted changes block a
switch or merge. After a merge, the work hex links to a diff view of what landed; the diff is also
saved under `.hx/diffs/` in case the commits disappear.

## MCP server

Studio serves MCP itself over streamable HTTP at `http://localhost:8000/mcp`, sharing one service
with the UI, and `.mcp.json` points Claude Code at it (start Studio first). It works on the folder
last opened in Studio, or on `HEXES_DIR` if set. The stdio entry (`deno task mcp`) still exists for
clients that need a spawned process.

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
